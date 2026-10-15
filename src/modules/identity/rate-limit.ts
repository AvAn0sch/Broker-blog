import type { Pool } from "pg";
import type { Clock } from "../../infrastructure/clock";
import { consumeRateLimits, type RateRule } from "../../infrastructure/rate-limit";
import { authPolicy } from "./policy";

export async function limitAuthentication(pool: Pool, secret: string, clock: Clock, action: "captcha" | "register" | "login", browser: string, email?: string) {
  const rules: RateRule[] = [{ name: `${action}.browser`, subject: browser, ...authPolicy.limits[action] },
    ...(email ? [{ name: `${action}.email`, subject: email, ...authPolicy.limits[action] }] : []),
    { name: `${action}.global`, subject: "all", ...authPolicy.limits.global }];
  await consumeRateLimits(pool, secret, clock, rules);
}
