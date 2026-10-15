import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../contracts/errors";
import type { Clock } from "./clock";
import { withTransaction } from "./db/transaction";

export type RateRule = { name: string; subject: string; count: number; ms: number };

/** Fixed-window counters shared by authentication, upload and any other limited action. */
export async function consumeRateLimits(pool: Pool, secret: string, clock: Clock, rules: RateRule[]) {
  const blocked = await withTransaction(pool, async ({ client }) => {
    let blocked = false;
    for (const rule of rules) {
      const window = new Date(Math.floor(clock.now().getTime() / rule.ms) * rule.ms);
      const subject = createHmac("sha256", secret).update(`rate-subject\0${rule.subject}`).digest("hex");
      const result = await client.query(`INSERT INTO rate_limit_buckets (action,subject_hash,window_start,count) VALUES ($1,$2,$3,1)
        ON CONFLICT (action,subject_hash,window_start) DO UPDATE SET count=LEAST(rate_limit_buckets.count+1,$4) RETURNING count`,
      [rule.name, subject, window, rule.count + 1]);
      blocked ||= result.rows[0].count > rule.count;
    }
    return blocked;
  });
  if (blocked) throw new AppError("RATE_LIMITED", 429, "操作过于频繁，请稍后再试。");
}
