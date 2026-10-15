import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { withTransaction } from "../../src/infrastructure/db/transaction";
import { testControls } from "../../src/infrastructure/testing/controls";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { hashPassword, verifyPassword } from "../../src/infrastructure/password";
import { identityService } from "../../src/modules/identity/service";
import { authPolicy } from "../../src/modules/identity/policy";
import { csrfToken, secretToken, digest } from "../../src/modules/identity/security";
import { initializeAdministrator, resetSyntheticPassword } from "../../src/modules/identity/administration";

let pool: Pool;
const sessionSecret = process.env.SESSION_SECRET!;
const password = digest(sessionSecret, "test-fixture-password", process.env.TEST_RUN_ID!);
const captchaSecret = process.env.CAPTCHA_SECRET!;
const email = () => `${randomUUID()}@example.test`;
const service = () => identityService({ pool, sessionSecret, captchaSecret });
let fixtureEmail: string;
let administratorEmail: string;
test.beforeAll(async () => {
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  fixtureEmail = `fixture-${process.env.TEST_RUN_ID}@example.test`; administratorEmail = `admin-${process.env.TEST_RUN_ID}@example.test`;
  await pool.query("INSERT INTO users (email_normalized,password_hash,nickname) VALUES ($1,$2,'基础账号') ON CONFLICT DO NOTHING", [fixtureEmail, await hashPassword(password)]);
  if (!(await pool.query("SELECT 1 FROM users WHERE email_normalized=$1", [administratorEmail])).rowCount) await initializeAdministrator(pool, { email: administratorEmail, password, nickname: "本地管理员" });
});
test.afterAll(async () => { await pool?.end(); });

async function context(request: APIRequestContext) {
  const response = await request.get("/api/v1/auth/context");
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function challenge(request: APIRequestContext, purpose: "login" | "register") {
  const current = await context(request);
  const headers = { Origin: "http://127.0.0.1:3100", "X-CSRF-Token": current.anonymousCsrfToken };
  const response = await request.post("/api/v1/auth/captcha", { headers, data: { purpose } });
  expect(response.status()).toBe(200);
  const data = (await response.json()).data;
  return { headers, challengeId: data.challengeId as string, captcha: await readTestCaptcha(data.challengeId) };
}
async function login(request: APIRequestContext, target = fixtureEmail, pass = password) {
  const current = await challenge(request, "login");
  return request.post("/api/v1/auth/login", { headers: current.headers, data: { email: target, password: pass, challengeId: current.challengeId, captcha: current.captcha } });
}

test("AUTH-01 password hashing uses independent salt and real verification", async () => {
  const first = await hashPassword(password), second = await hashPassword(password);
  expect(first !== second && !first.includes(password)).toBe(true);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword(`${password} `, first)).toBe(false);
  expect(await verifyPassword(password, "unusable:fixture")).toBe(false);
});

test("AUTH-01 registration is persistent, normalized and limited to ordinary users", async ({ request }) => {
  const target = email(); const current = await challenge(request, "register");
  const response = await request.post("/api/v1/auth/register", { headers: current.headers, data: { email: ` ${target.toUpperCase()} `, password, nickname: "新成员", challengeId: current.challengeId, captcha: current.captcha } });
  expect(response.status()).toBe(200);
  const result = (await response.json()).data;
  expect(result.user).toMatchObject({ email: target, nickname: "新成员", role: "user", status: "normal" });
  expect(Object.keys(result).sort()).toEqual(["user"]);
  const row = (await pool.query("SELECT password_hash FROM users WHERE id=$1", [result.user.id])).rows[0];
  expect(await verifyPassword(password, row.password_hash)).toBe(true);
  const again = await challenge(request, "register");
  const duplicate = await request.post("/api/v1/auth/register", { headers: again.headers, data: { email: target, password, nickname: "重复账号", challengeId: again.challengeId, captcha: again.captcha } });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).error.code).toBe("EMAIL_IN_USE");
  expect((await pool.query("SELECT count(*)::int AS n FROM users WHERE email_normalized=$1", [target])).rows[0].n).toBe(1);
});

test("AUTH-01 malformed email, weak password and role injection are rejected", async ({ request }) => {
  const current = await challenge(request, "register");
  const base = { email: email(), password, nickname: "测试账号", challengeId: current.challengeId, captcha: current.captcha };
  for (const patch of [{ email: "invalid" }, { password: "short" }, { role: "admin" }, { nickname: "x" }]) {
    const response = await request.post("/api/v1/auth/register", { headers: current.headers, data: { ...base, ...patch } });
    expect(response.status()).toBe(400);
  }
  expect((await pool.query("SELECT consumed_at FROM captcha_challenges WHERE id=$1", [current.challengeId])).rows[0].consumed_at).toBeNull();
});

test("AUTH-01 unknown email and wrong password never create accounts and consume the successful challenge", async ({ request }) => {
  const absent = email();
  const current = await challenge(request, "login");
  const data = { email: absent, password, challengeId: current.challengeId, captcha: current.captcha };
  const unknown = await request.post("/api/v1/auth/login", { headers: current.headers, data });
  expect(unknown.status()).toBe(401);
  expect((await unknown.json()).error.code).toBe("INVALID_CREDENTIALS");
  const reused = await request.post("/api/v1/auth/login", { headers: current.headers, data });
  expect((await reused.json()).error.code).toBe("CAPTCHA_INVALID");
  const incorrect = await login(request, fixtureEmail, "This password is incorrect");
  expect((await incorrect.json()).error.code).toBe("INVALID_CREDENTIALS");
  expect((await pool.query("SELECT 1 FROM users WHERE email_normalized=$1", [absent])).rowCount).toBe(0);
});

test("AUTH-01 captcha pixels are returned without answer fields and refresh invalidates previous challenge", async ({ request }) => {
  const first = await challenge(request, "login");
  const response = await request.post("/api/v1/auth/captcha", { headers: first.headers, data: { purpose: "login" } });
  const body = (await response.json()).data;
  expect(Object.keys(body).sort()).toEqual(["challengeId", "expiresAt", "image"]);
  expect(body.image.startsWith("data:image/png;base64,")).toBe(true);
  const rejected = await request.post("/api/v1/auth/login", { headers: first.headers, data: { email: fixtureEmail, password, challengeId: first.challengeId, captcha: first.captcha } });
  expect((await rejected.json()).error.code).toBe("CAPTCHA_INVALID");
});

test("AUTH-01 captcha failures persist, fifth attempt exhausts it, and expiry uses a controlled clock", async () => {
  const control = testControls(); const auth = identityService({ pool, sessionSecret, captchaSecret, clock: control.clock });
  const browser = secretToken(); const challenge = await auth.issueCaptcha(browser, "login");
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(auth.consumeCaptcha(browser, "login", challenge.challengeId, "WRONG!")).rejects.toMatchObject({ code: attempt === 5 ? "CAPTCHA_EXHAUSTED" : "CAPTCHA_INCORRECT" });
    expect((await pool.query("SELECT attempts FROM captcha_challenges WHERE id=$1", [challenge.challengeId])).rows[0].attempts).toBe(attempt);
  }
  await expect(auth.consumeCaptcha(browser, "login", challenge.challengeId, challenge.answer)).rejects.toMatchObject({ code: "CAPTCHA_EXHAUSTED" });
  const expiring = await auth.issueCaptcha(browser, "login");
  control.advance(authPolicy.captchaMs);
  await expect(auth.consumeCaptcha(browser, "login", expiring.challengeId, expiring.answer)).rejects.toMatchObject({ code: "CAPTCHA_EXPIRED" });
});

test("AUTH-01 challenge cannot cross browser or purpose; parallel validation has one winner", async () => {
  const auth = service(), browser = secretToken(); const challenge = await auth.issueCaptcha(browser, "login");
  await expect(auth.consumeCaptcha(secretToken(), "login", challenge.challengeId, challenge.answer)).rejects.toMatchObject({ code: "CAPTCHA_INVALID" });
  await expect(auth.consumeCaptcha(browser, "register", challenge.challengeId, challenge.answer)).rejects.toMatchObject({ code: "CAPTCHA_INVALID" });
  const outcomes = await Promise.allSettled([auth.consumeCaptcha(browser, "login", challenge.challengeId, challenge.answer), auth.consumeCaptcha(browser, "login", challenge.challengeId, challenge.answer)]);
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await pool.query("SELECT attempts FROM captcha_challenges WHERE id=$1", [challenge.challengeId])).rows[0].attempts).toBe(1);
});

test("AUTH-01 concurrent registration creates one account and one session", async () => {
  const auth = service(), browser = secretToken(), target = email();
  const current = await auth.issueCaptcha(browser, "register");
  const data = { email: target, password, nickname: "并发账号", challengeId: current.challengeId, captcha: current.answer };
  const results = await Promise.allSettled([auth.register(data, browser), auth.register(data, browser)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const row = await pool.query("SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email_normalized=$1", [target]);
  expect(row.rows[0].n).toBe(1);
});

test("SECURITY-01 missing or foreign Origin, mismatched pre-session and forged actor are rejected", async ({ request, playwright, baseURL }) => {
  const current = await challenge(request, "login");
  const data = { email: fixtureEmail, password, challengeId: current.challengeId, captcha: current.captcha };
  for (const headers of [{ "X-CSRF-Token": current.headers["X-CSRF-Token"] }, { ...current.headers, Origin: "https://evil.test" }, { ...current.headers, "X-CSRF-Token": "0".repeat(64) }]) {
    expect((await request.post("/api/v1/auth/login", { headers, data })).status()).toBe(403);
  }
  const other = await playwright.request.newContext({ baseURL });
  try {
    await context(other);
    expect((await other.post("/api/v1/auth/login", { headers: current.headers, data })).status()).toBe(403);
    expect((await other.get("/api/v1/auth/me", { headers: { "X-Actor-ID": "00000000-0000-4000-8000-000000000001", "X-Role": "admin" } })).status()).toBe(401);
  } finally { await other.dispose(); }
  expect((await login(request)).status()).toBe(200);
});

test("AUTH-01 database sessions are HttpOnly, rotate at login, expire and revoke on logout", async ({ request }) => {
  const first = await login(request);
  expect(first.status()).toBe(200);
  const setCookie = first.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie").find((header) => header.value.startsWith("bb_session="))?.value ?? "";
  expect(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=lax") && setCookie.includes("Path=/")).toBe(true);
  const oldToken = (await request.storageState()).cookies.find((cookie) => cookie.name === "bb_session")!.value;
  expect((await pool.query("SELECT 1 FROM sessions WHERE token_hash=$1", [oldToken])).rowCount).toBe(0);
  expect((await login(request)).status()).toBe(200);
  expect(await service().readSession(oldToken)).toBeNull();
  const ctx = await context(request);
  const blocked = await request.post("/api/v1/auth/logout", { headers: { Origin: "http://127.0.0.1:3100", "X-CSRF-Token": "0".repeat(64) }, data: {} });
  expect(blocked.status()).toBe(403);
  const newToken = (await request.storageState()).cookies.find((cookie) => cookie.name === "bb_session")!.value;
  const control = testControls(); control.advance(authPolicy.sessionMs);
  expect(await identityService({ pool, sessionSecret, captchaSecret, clock: control.clock }).readSession(newToken)).toBeNull();
  const logout = await request.post("/api/v1/auth/logout", { headers: { Origin: "http://127.0.0.1:3100", "X-CSRF-Token": ctx.csrfToken }, data: {} });
  expect(logout.status()).toBe(200);
  expect(await service().readSession(newToken)).toBeNull();
  expect((await request.get("/api/v1/auth/me")).status()).toBe(401);
});

test("AUTH-02 role and ban changes apply to existing sessions, writes require session CSRF", async ({ request }) => {
  expect((await login(request)).status()).toBe(200);
  expect((await request.get("/api/v1/admin/access")).status()).toBe(403);
  const token = (await request.storageState()).cookies.find((cookie) => cookie.name === "bb_session")!.value;
  const auth = service(); const csrf = csrfToken(sessionSecret, "session", token);
  await expect(withTransaction(pool, (tx) => auth.requireActor(tx, token, { write: true, csrf: "0".repeat(64) }))).rejects.toMatchObject({ code: "CSRF_REJECTED" });
  await withTransaction(pool, (tx) => auth.requireActor(tx, token, { write: true, csrf }));
  await pool.query("UPDATE users SET status='banned' WHERE email_normalized=$1", [fixtureEmail]);
  try {
    const user = (await request.get("/api/v1/auth/me")); expect(user.status()).toBe(200);
    expect((await user.json()).data.user.status).toBe("banned");
    await expect(withTransaction(pool, (tx) => auth.requireActor(tx, token, { write: true, csrf }))).rejects.toMatchObject({ code: "ACCOUNT_BANNED" });
    const ctx = await context(request);
    expect((await request.post("/api/v1/auth/logout", { headers: { Origin: "http://127.0.0.1:3100", "X-CSRF-Token": ctx.csrfToken }, data: {} })).status()).toBe(200);
  } finally { await pool.query("UPDATE users SET status='normal' WHERE email_normalized=$1", [fixtureEmail]); }
  expect((await login(request, administratorEmail)).status()).toBe(200);
  expect((await request.get("/api/v1/admin/access")).status()).toBe(200);
  await pool.query("UPDATE users SET role='user' WHERE email_normalized=$1", [administratorEmail]);
  try { expect((await request.get("/api/v1/admin/access")).status()).toBe(403); }
  finally { await pool.query("UPDATE users SET role='admin' WHERE email_normalized=$1", [administratorEmail]); }
});

test("AUTH-01 captcha, registration and login rate buckets persist across service instances", async () => {
  const control = testControls();
  const auth = () => identityService({ pool, sessionSecret, captchaSecret, clock: control.clock });
  const browser = secretToken();
  for (let i = 0; i < authPolicy.limits.captcha.count; i++) await auth().issueCaptcha(browser, "login");
  await expect(auth().issueCaptcha(browser, "login")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  control.advance(authPolicy.limits.captcha.ms);
  await auth().issueCaptcha(browser, "login");
  for (const purpose of ["register", "login"] as const) {
    const token = secretToken(), target = email();
    for (let i = 0; i < authPolicy.limits[purpose].count; i++) {
      const current = await auth().issueCaptcha(token, purpose);
      const input = { email: target, password, ...(purpose === "register" ? { nickname: "限流账号" } : {}), challengeId: current.challengeId, captcha: "WRONG!" };
      await expect(auth()[purpose](input, token)).rejects.toMatchObject({ code: "CAPTCHA_INCORRECT" });
    }
    const current = await auth().issueCaptcha(token, purpose);
    const input = { email: target, password, ...(purpose === "register" ? { nickname: "限流账号" } : {}), challengeId: current.challengeId, captcha: current.answer };
    await expect(auth()[purpose](input, token)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const rotatedBrowser = secretToken();
    const rotated = await auth().issueCaptcha(rotatedBrowser, purpose);
    await expect(auth()[purpose]({ ...input, challengeId: rotated.challengeId, captcha: rotated.answer }, rotatedBrowser)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  }
});

test("AUTH-01 restricted reset CLI changes the hash, audits and revokes every previous session", async ({ request }) => {
  const target = email(), replacement = secretToken();
  await pool.query("INSERT INTO users (email_normalized,password_hash,nickname) VALUES ($1,$2,'重置账号')", [target, await hashPassword(password)]);
  expect((await login(request, target)).status()).toBe(200);
  const token = (await request.storageState()).cookies.find((cookie) => cookie.name === "bb_session")!.value;
  const file = path.resolve(".local/test-runs", process.env.TEST_RUN_ID!, "media", "reset-input.json");
  await writeFile(file, JSON.stringify({ operatorEmail: administratorEmail, email: target, password: replacement, reason: "认证重置验收" }), { mode: 0o600 });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/accounts.mjs", "reset-password", "--input-file", file], { env: process.env, stdio: "ignore", windowsHide: true });
      child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
    });
    expect(code).toBe(0);
  } finally { await unlink(file); }
  expect(await service().readSession(token)).toBeNull();
  expect((await request.get("/api/v1/auth/me")).status()).toBe(401);
  expect((await login(request, target, password)).status()).toBe(401);
  expect((await login(request, target, replacement)).status()).toBe(200);
  const audit = await pool.query("SELECT 1 FROM audit_logs a JOIN users u ON a.target_id=u.id WHERE u.email_normalized=$1 AND a.action='identity.password-reset'", [target]);
  expect(audit.rowCount).toBe(1);
});

test("AUTH-01 local initialization preserves existing accounts and reset is limited to synthetic users", async () => {
  await expect(initializeAdministrator(pool, { email: administratorEmail, password, nickname: "覆盖尝试" })).rejects.toMatchObject({ code: "ADMIN_ALREADY_INITIALIZED" });
  await expect(resetSyntheticPassword(pool, { operatorEmail: administratorEmail, email: "real@example.com", password, reason: "无效目标" })).rejects.toThrow();
});
