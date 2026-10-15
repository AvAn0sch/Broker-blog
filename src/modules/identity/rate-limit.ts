import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import type { Clock } from "../../infrastructure/clock";
import { withTransaction } from "../../infrastructure/db/transaction";
import { authPolicy } from "./policy";
import { digest } from "./security";

export async function limitAuthentication(pool: Pool, secret: string, clock: Clock, action: "captcha" | "register" | "login", browser: string, email?: string) {
  const rules = [{ name: `${action}.browser`, subject: browser, ...authPolicy.limits[action] },
    ...(email ? [{ name: `${action}.email`, subject: email, ...authPolicy.limits[action] }] : []),
    { name: `${action}.global`, subject: "all", ...authPolicy.limits.global }];
  const blocked = await withTransaction(pool, async ({ client }) => {
    let blocked = false;
    for (const rule of rules) {
      const window = new Date(Math.floor(clock.now().getTime() / rule.ms) * rule.ms);
      const result = await client.query(`INSERT INTO rate_limit_buckets (action,subject_hash,window_start,count) VALUES ($1,$2,$3,1)
        ON CONFLICT (action,subject_hash,window_start) DO UPDATE SET count=LEAST(rate_limit_buckets.count+1,$4) RETURNING count`,
      [rule.name, digest(secret, "rate-subject", rule.subject), window, rule.count + 1]);
      blocked ||= result.rows[0].count > rule.count;
    }
    return blocked;
  });
  if (blocked) throw new AppError("RATE_LIMITED", 429, "操作过于频繁，请稍后再试。");
}
