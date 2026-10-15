import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { withTransaction } from "../../src/infrastructure/db/transaction";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { secretToken } from "../../src/modules/identity/security";
import { mediaPolicy } from "../../src/modules/media/policy";
import { htmlBytes, paddedPng, pngBytes, svgBytes } from "../fixtures/images";

const password = secretToken();
// 与应用实际入口保持单一来源：容器与原生环境下测试进程的 APP_ORIGIN 可能不同。
let origin = "http://127.0.0.1:3100";
let pool: Pool;
let author: Account;
let other: Account;
let reviewer: Account;

type Account = { context: APIRequestContext; userId: string; csrf: string; nickname: string };
type RequestFactory = { request: { newContext: (options: { baseURL?: string }) => Promise<APIRequestContext> } };

test.beforeAll(async ({ playwright, baseURL }) => {
  origin = baseURL!;
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  // 账号在文件内共享：全局限流按分钟统计，逐用例注册会在快速执行的轮次中触发产品限流。
  author = await createAccount(playwright, baseURL!, "媒体作者");
  other = await createAccount(playwright, baseURL!, "媒体旁观");
  reviewer = await createAccount(playwright, baseURL!, "媒体管理员");
});
test.afterAll(async () => {
  await author?.context.dispose(); await other?.context.dispose(); await reviewer?.context.dispose();
  await pool?.end();
});

async function createAccount(playwright: RequestFactory, baseURL: string, nickname: string): Promise<Account> {
  const context = await playwright.request.newContext({ baseURL });
  const email = `${randomUUID()}@example.test`;
  const bootstrap = (await (await context.get("/api/v1/auth/context")).json()).data;
  const headers = { Origin: origin, "X-CSRF-Token": bootstrap.anonymousCsrfToken as string };
  // 并发密码哈希达到上限时返回可重试 503；按产品语义重新取验证码并重试注册。
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

function upload(account: Account, bytes: Buffer, options: { key?: string; type?: string; omitOrigin?: boolean; badCsrf?: boolean } = {}) {
  return account.context.post("/api/v1/media", {
    headers: {
      "Content-Type": options.type ?? "image/png",
      "X-CSRF-Token": options.badCsrf ? "0".repeat(64) : account.csrf,
      "X-Idempotency-Key": options.key ?? randomUUID(),
      ...(options.omitOrigin ? {} : { Origin: origin }),
    },
    data: bytes,
  });
}

async function uploadMedia(account: Account, bytes: Buffer) {
  const response = await upload(account, bytes);
  expect(response.status()).toBe(200);
  return (await response.json()).data.media as { id: string; mime: string; size: number; status: string };
}

async function encodedImage(page: Page, mime: string) {
  const dataUrl = await page.evaluate((type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 8; canvas.height = 6;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(34,119,93)"; context.fillRect(0, 0, 8, 6);
    return canvas.toDataURL(type, 0.9);
  }, mime);
  const [prefix, base64] = dataUrl.split(",");
  expect(prefix).toBe(`data:${mime};base64`);
  return Buffer.from(base64, "base64");
}

async function publishArticle(userId: string, mediaId: string) {
  const articleId = randomUUID();
  await pool.query("INSERT INTO articles (id,author_id,status,first_published_at,state_version) VALUES ($1,$2,'published',now(),2)", [articleId, userId]);
  await pool.query("INSERT INTO article_publications (article_id,source_draft_version,title,markdown,summary,plain_text) VALUES ($1,1,'标题','正文','摘要','正文')", [articleId]);
  await pool.query("INSERT INTO publication_media (article_id,media_id) VALUES ($1,$2)", [articleId, mediaId]);
  return articleId;
}

test("B1 an authenticated member uploads a real image and reads it back", async () => {
  const bytes = pngBytes(8, 6);
  const response = await upload(author, bytes);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.replayed).toBe(false);
  expect(body.data.media).toMatchObject({ mime: "image/png", size: bytes.length, status: "ready" });
  const read = await author.context.get(`/api/v1/media/${body.data.media.id}`);
  expect(read.status()).toBe(200);
  expect(read.headers()["content-type"]).toBe("image/png");
  expect(read.headers()["x-content-type-options"]).toBe("nosniff");
  expect(read.headers()["cache-control"]).toBe("no-store");
  expect((await read.body()).equals(bytes)).toBe(true);
});

test("B1 browser-encoded JPEG and WebP images keep their real type", async ({ page }) => {
  for (const mime of ["image/jpeg", "image/webp"]) {
    const bytes = await encodedImage(page, mime);
    const response = await upload(author, bytes, { type: mime });
    expect(response.status()).toBe(200);
    const media = (await response.json()).data.media;
    expect(media.mime).toBe(mime);
    expect((await author.context.get(`/api/v1/media/${media.id}`)).status()).toBe(200);
  }
});

test("B1 forged, unsupported and oversize bodies are refused", async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM media WHERE owner_id=$1", [author.userId])).rows[0].n;
  const forged = await upload(author, htmlBytes, { type: "image/png" });
  expect(forged.status()).toBe(415);
  expect((await forged.json()).error.code).toBe("MEDIA_TYPE_REJECTED");
  expect((await upload(author, svgBytes, { type: "image/png" })).status()).toBe(415);
  const oversize = await upload(author, paddedPng(mediaPolicy.maxBytes + 1));
  expect(oversize.status()).toBe(413);
  expect((await oversize.json()).error.code).toBe("MEDIA_TOO_LARGE");
  expect((await pool.query("SELECT count(*)::int AS n FROM media WHERE owner_id=$1", [author.userId])).rows[0].n).toBe(before);
});

test("B1 upload requires session CSRF, the exact origin and a signed-in account", async ({ playwright, baseURL }) => {
  const guest = await playwright.request.newContext({ baseURL });
  try {
    expect((await upload(author, pngBytes(), { badCsrf: true })).status()).toBe(403);
    expect((await upload(author, pngBytes(), { omitOrigin: true })).status()).toBe(403);
    const anonymous = await guest.post("/api/v1/media", { headers: { Origin: origin, "Content-Type": "image/png", "X-CSRF-Token": "0".repeat(64), "X-Idempotency-Key": randomUUID() }, data: pngBytes() });
    expect(anonymous.status()).toBe(401);
  } finally { await guest.dispose(); }
});

test("B1 private media is hidden from guests and other members", async ({ playwright, baseURL }) => {
  const guest = await playwright.request.newContext({ baseURL });
  try {
    const media = await uploadMedia(author, pngBytes());
    expect((await author.context.get(`/api/v1/media/${media.id}`)).status()).toBe(200);
    expect((await other.context.get(`/api/v1/media/${media.id}`)).status()).toBe(404);
    expect((await guest.get(`/api/v1/media/${media.id}`)).status()).toBe(404);
    expect((await guest.get(`/api/v1/media/${randomUUID()}`)).status()).toBe(404);
    expect((await guest.get("/api/v1/media/not-a-uuid")).status()).toBe(404);
  } finally { await guest.dispose(); }
});

test("B1 published references open media to guests and takedown revokes them", async ({ playwright, baseURL }) => {
  const guest = await playwright.request.newContext({ baseURL });
  try {
    const media = await uploadMedia(author, pngBytes());
    const articleId = await publishArticle(author.userId, media.id);
    expect((await guest.get(`/api/v1/media/${media.id}`)).status()).toBe(200);
    await pool.query("UPDATE articles SET status='taken_down',state_version=state_version+1 WHERE id=$1", [articleId]);
    expect((await guest.get(`/api/v1/media/${media.id}`)).status()).toBe(404);
    expect((await author.context.get(`/api/v1/media/${media.id}`)).status()).toBe(200);
  } finally { await guest.dispose(); }
});

test("B1 avatar and review references follow the governance rules", async ({ playwright, baseURL }) => {
  const guest = await playwright.request.newContext({ baseURL });
  try {
    const avatar = await uploadMedia(author, pngBytes(3, 3));
    await pool.query("UPDATE users SET avatar_media_id=$2 WHERE id=$1", [author.userId, avatar.id]);
    expect((await guest.get(`/api/v1/media/${avatar.id}`)).status()).toBe(200);

    const reviewed = await uploadMedia(author, pngBytes(4, 3));
    const articleId = randomUUID();
    const reviewId = randomUUID();
    await pool.query("INSERT INTO articles (id,author_id,status,first_published_at,state_version) VALUES ($1,$2,'taken_down',now(),2)", [articleId, author.userId]);
    await withTransaction(pool, async (tx) => {
      await tx.client.query("INSERT INTO review_requests (id,article_id,source_draft_version,title,markdown,summary,status,version,submitted_by) VALUES ($1,$2,1,'标题','正文','摘要','pending',1,$3)", [reviewId, articleId, author.userId]);
      await tx.client.query("INSERT INTO review_media (review_id,media_id) VALUES ($1,$2)", [reviewId, reviewed.id]);
    });
    expect((await guest.get(`/api/v1/media/${reviewed.id}`)).status()).toBe(404);
    expect((await other.context.get(`/api/v1/media/${reviewed.id}`)).status()).toBe(404);

    const draftOnly = await uploadMedia(author, pngBytes(4, 4));
    await pool.query("INSERT INTO article_drafts (article_id,version,title,markdown,summary) VALUES ($1,1,'草稿','正文','摘要')", [articleId]);
    await pool.query("INSERT INTO draft_media (article_id,media_id) VALUES ($1,$2)", [articleId, draftOnly.id]);

    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [reviewer.userId]);
    expect((await reviewer.context.get(`/api/v1/media/${reviewed.id}`)).status()).toBe(200);
    expect((await reviewer.context.get(`/api/v1/media/${draftOnly.id}`)).status()).toBe(404);

    await pool.query("UPDATE users SET status='banned' WHERE id=$1", [reviewer.userId]);
    expect((await reviewer.context.get(`/api/v1/media/${reviewed.id}`)).status()).toBe(404);
  } finally {
    // 其他 spec 依赖“管理员由受限脚本初始化”的前置条件，治理读取验证后立即恢复账号。
    await pool.query("UPDATE users SET role='user',status='normal' WHERE id=$1", [reviewer.userId]);
    await guest.dispose();
  }
});

test("B1 upload replay with the same key reuses the ready media", async () => {
  const key = randomUUID();
  const bytes = pngBytes(6, 6);
  const first = (await (await upload(author, bytes, { key })).json()).data;
  const second = (await (await upload(author, bytes, { key })).json()).data;
  expect(second.replayed).toBe(true);
  expect(second.media.id).toBe(first.media.id);
  const conflict = await upload(author, pngBytes(7, 7), { key });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
});
