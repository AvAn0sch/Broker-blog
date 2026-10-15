import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { secretToken } from "../../src/modules/identity/security";

export type ApiAccount = { context: APIRequestContext; id: string; csrf: string; origin: string };
export async function apiAccount(playwright: { request: { newContext(options: { baseURL: string }): Promise<APIRequestContext> } }, origin: string, nickname: string): Promise<ApiAccount> {
  const context = await playwright.request.newContext({ baseURL: origin });
  try {
    const anonymous = (await (await context.get("/api/v1/auth/context")).json()).data.anonymousCsrfToken;
    const headers = { Origin: origin, "X-CSRF-Token": anonymous };
    const challenge = (await (await context.post("/api/v1/auth/captcha", { headers, data: { purpose: "register" } })).json()).data.challengeId;
    const response = await context.post("/api/v1/auth/register", { headers, data: { email: `${randomUUID()}@example.test`, password: secretToken(), nickname, challengeId: challenge, captcha: await readTestCaptcha(challenge) } });
    if (!response.ok()) throw new Error(`Synthetic registration failed with HTTP ${response.status()}`);
    const id = (await response.json()).data.user.id;
    const csrf = (await (await context.get("/api/v1/auth/context")).json()).data.csrfToken;
    return { context, id, csrf, origin };
  } catch (error) { await context.dispose(); throw error; }
}
export function apiHeaders(account: ApiAccount, key = randomUUID()) { return { Origin: account.origin, "X-CSRF-Token": account.csrf, "X-Idempotency-Key": key }; }
