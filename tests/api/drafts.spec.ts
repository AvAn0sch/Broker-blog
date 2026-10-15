import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { secretToken } from "../../src/modules/identity/security";
import { pngBytes } from "../fixtures/images";

const password = secretToken();
let origin = "http://127.0.0.1:3100";
let pool: Pool;
let author: Account;
let other: Account;

type Account = { context: APIRequestContext; userId: string; csrf: string; nickname: string };
type RequestFactory = { request: { newContext: (options: { baseURL?: string }) => Promise<APIRequestContext> } };
type Draft = { articleId: string; version: number; title: string; markdown: string; summary: string; status: string };

test.beforeAll(async ({ playwright, baseURL }) => {
  origin = baseURL!;
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  author = await createAccount(playwright, baseURL!, "草稿作者");
  other = await createAccount(playwright, baseURL!, "草稿旁观");
});
test.afterAll(async () => {
  await author?.context.dispose(); await other?.context.dispose();
  await pool?.end();
});

async function createAccount(playwright: RequestFactory, baseURL: string, nickname: string): Promise<Account> {
  const context = await playwright.request.newContext({ baseURL });
  const email = `${randomUUID()}@example.test`;
  const bootstrap = (await (await context.get("/api/v1/auth/context")).json()).data;
  const headers = { Origin: origin, "X-CSRF-Token": bootstrap.anonymousCsrfToken as string };
  for (let attempt = 0; attempt < 3; attempt++) {
    const challengeResponse = await context.post("/api/v1/auth/captcha", { headers, data: { purpose: "register" } });
    if (challengeResponse.status() !== 200) throw new Error(`captcha request failed with status ${challengeResponse.status()}`);
    const challenge = (await challengeResponse.json()).data as { challengeId: string };
    const created = await context.post("/api/v1/auth/register", { headers, data: { email, password, nickname, challengeId: challenge.challengeId, captcha: await readTestCaptcha(challenge.challengeId) } });
    if (created.status() === 200) {
      const userId = (await created.json()).data.user.id as string;
      const session = (await (await context.get("/api/v1/auth/context")).json()).data;
      return { context, userId, csrf: session.csrfToken as string, nickname };
    }
    const failure = await created.json();
    if (failure.error?.code !== "SERVICE_UNAVAILABLE") throw new Error(`registration failed: ${JSON.stringify(failure)}`);
  }
  throw new Error("registration did not complete after three attempts");
}

function writeHeaders(account: Account, key = randomUUID(), csrf = account.csrf) {
  return { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, "X-Idempotency-Key": key };
}

async function createDraft(account: Account, body: Partial<{ title: string; markdown: string; summary: string }> = {}, key = randomUUID()) {
  const response = await account.context.post("/api/v1/articles", { headers: writeHeaders(account, key), data: body, failOnStatusCode: false });
  return { response, body: response.ok() ? (await response.json()).data as { draft: Draft; replayed: boolean } : null };
}

async function saveDraft(account: Account, draft: Draft, patch: Partial<{ title: string; markdown: string; summary: string; baseDraftVersion: number }> = {}, key = randomUUID()) {
  const response = await account.context.patch(`/api/v1/articles/${draft.articleId}/draft`, {
    headers: writeHeaders(account, key),
    data: { baseDraftVersion: draft.version, title: draft.title, markdown: draft.markdown, summary: draft.summary, ...patch },
    failOnStatusCode: false,
  });
  return { response, body: response.ok() ? (await response.json()).data as { draft: Draft; replayed: boolean; version: number } : null };
}

/** 直接登记一条上传中的媒体行，用于验证未完成媒体不能被草稿引用。 */
async function stagingMedia(ownerId: string) {
  const id = randomUUID();
  await pool.query("INSERT INTO media (id,owner_id,storage_key,mime,size,status,upload_lease_until) VALUES ($1,$2,$3,'image/png',64,'staging',now() + interval '60 seconds')", [id, ownerId, `${ownerId}/${id}.png`]);
  return id;
}

test("B2 draft creation is idempotent and stays private to its author", async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM articles WHERE author_id=$1", [author.userId])).rows[0].n;
  const key = randomUUID();
  const first = await createDraft(author, { title: "第一篇草稿" }, key);
  expect(first.response.status()).toBe(200);
  expect(first.body?.draft.version).toBe(1);
  expect(first.body?.replayed).toBe(false);
  const retry = await createDraft(author, { title: "第一篇草稿" }, key);
  expect(retry.body?.draft.articleId).toBe(first.body?.draft.articleId);
  expect(retry.body?.replayed).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS n FROM articles WHERE author_id=$1", [author.userId])).rows[0].n).toBe(before + 1);

  const articleId = first.body!.draft.articleId;
  expect((await other.context.get(`/api/v1/articles/${articleId}/draft`)).status()).toBe(404);
  expect((await other.context.patch(`/api/v1/articles/${articleId}/draft`, { headers: writeHeaders(other), data: { baseDraftVersion: 1, title: "改", markdown: "改", summary: "" } })).status()).toBe(404);
  expect((await author.context.get(`/api/v1/articles/${articleId}/draft`, { failOnStatusCode: false })).status()).toBe(200);
});

test("B2 draft saves advance the version, replay safely and refuse stale base versions", async () => {
  const created = await createDraft(author, { title: "版本草稿" });
  const draft = created.body!.draft;
  const saveKey = randomUUID();
  const saved = await saveDraft(author, draft, { title: "版本草稿", markdown: "第一版正文" }, saveKey);
  expect(saved.response.status()).toBe(200);
  expect(saved.body?.draft.version).toBe(2);
  expect(saved.body?.draft.markdown).toBe("第一版正文");

  // 同一提交标识与同一请求体重放：返回同一版本，不重复推进。
  const replay = await saveDraft(author, draft, { title: "版本草稿", markdown: "第一版正文" }, saveKey);
  expect(replay.body?.replayed).toBe(true);
  expect(replay.body?.draft.version).toBe(2);

  const current = (await (await author.context.get(`/api/v1/articles/${draft.articleId}/draft`)).json()).data.draft as Draft;
  expect(current.version).toBe(2);
  const stale = await saveDraft(author, { ...current, version: 1 }, { markdown: "旧窗口覆盖" });
  expect(stale.response.status()).toBe(409);
  expect((await stale.response.json()).error.code).toBe("DRAFT_VERSION_CONFLICT");
  expect(((await (await author.context.get(`/api/v1/articles/${draft.articleId}/draft`)).json()).data.draft as Draft).markdown).toBe("第一版正文");
});

test("B2 draft writes require a normal account and session CSRF", async () => {
  const created = await createDraft(author, { title: "权限草稿" });
  const draft = created.body!.draft;
  const noCsrf = await author.context.patch(`/api/v1/articles/${draft.articleId}/draft`, { headers: writeHeaders(author, randomUUID(), "0".repeat(64)), data: { baseDraftVersion: draft.version, title: "x", markdown: "x", summary: "" } });
  expect(noCsrf.status()).toBe(403);
  const noOrigin = await author.context.patch(`/api/v1/articles/${draft.articleId}/draft`, { headers: { "Content-Type": "application/json", "X-CSRF-Token": author.csrf, "X-Idempotency-Key": randomUUID() }, data: { baseDraftVersion: draft.version, title: "x", markdown: "x", summary: "" } });
  expect(noOrigin.status()).toBe(403);

  await pool.query("UPDATE users SET status='banned' WHERE id=$1", [author.userId]);
  try {
    expect((await author.context.get(`/api/v1/articles/${draft.articleId}/draft`)).status()).toBe(200);
    const blocked = await saveDraft(author, draft, { markdown: "封禁写入" });
    expect(blocked.response.status()).toBe(403);
    expect((await blocked.response.json()).error.code).toBe("ACCOUNT_BANNED");
  } finally { await pool.query("UPDATE users SET status='normal' WHERE id=$1", [author.userId]); }
});

test("B2 draft media references follow ownership and readiness", async () => {
  const created = await createDraft(author, { title: "引用草稿" });
  let draft = created.body!.draft;

  const upload = await author.context.post("/api/v1/media", { headers: { Origin: origin, "Content-Type": "image/png", "X-CSRF-Token": author.csrf, "X-Idempotency-Key": randomUUID() }, data: pngBytes() });
  expect(upload.status()).toBe(200);
  const ownMedia = (await upload.json()).data.media.id as string;

  const withReference = await saveDraft(author, draft, { markdown: `![图](/api/v1/media/${ownMedia})` });
  expect(withReference.response.status()).toBe(200);
  draft = withReference.body!.draft;
  expect((await pool.query("SELECT count(*)::int AS n FROM draft_media WHERE article_id=$1", [draft.articleId])).rows[0].n).toBe(1);

  const replaced = await saveDraft(author, draft, { markdown: "没有图片了" });
  expect(replaced.response.status()).toBe(200);
  expect((await pool.query("SELECT count(*)::int AS n FROM draft_media WHERE article_id=$1", [draft.articleId])).rows[0].n).toBe(0);

  const staging = await stagingMedia(author.userId);
  const notReady = await saveDraft(author, replaced.body!.draft, { markdown: `![图](/api/v1/media/${staging})` });
  expect(notReady.response.status()).toBe(409);
  expect((await notReady.response.json()).error.code).toBe("MEDIA_NOT_READY");

  const foreignUpload = await other.context.post("/api/v1/media", { headers: { Origin: origin, "Content-Type": "image/png", "X-CSRF-Token": other.csrf, "X-Idempotency-Key": randomUUID() }, data: pngBytes() });
  const foreignMedia = (await foreignUpload.json()).data.media.id as string;
  const foreign = await saveDraft(author, replaced.body!.draft, { markdown: `![图](/api/v1/media/${foreignMedia})` });
  expect(foreign.response.status()).toBe(403);
  expect((await foreign.response.json()).error.code).toBe("MEDIA_FORBIDDEN");
});
