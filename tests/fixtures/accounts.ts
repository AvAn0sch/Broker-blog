import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";

export async function answerCaptcha(page: Page) {
  const image = page.getByTestId("captcha-image");
  // 表单自动刷新失败时图片不会出现：主动刷新一次，再在有界时间内等待。
  if (!(await image.isVisible().catch(() => false))) await page.getByRole("button", { name: "刷新验证码" }).click({ timeout: 10_000 }).catch(() => {});
  await expect(image).toBeVisible({ timeout: 15_000 });
  expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 228)).toBe(true);
  const id = await image.getAttribute("data-challenge-id");
  if (!id) throw new Error("Challenge not loaded.");
  await page.getByLabel("图形验证码", { exact: true }).fill(await readTestCaptcha(id));
}

/** 可重试的失败：并发哈希上限的 503，以及刷新验证码窗口内的失效挑战。 */
async function retryable(response: { status(): number; json(): Promise<unknown> } | null) {
  if (!response) return true;
  if (response.status() === 503) return true;
  if (response.status() !== 400) return false;
  const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  return Boolean(body?.error?.code?.startsWith("CAPTCHA"));
}

/**
 * 开发态按需编译新路由时会向已打开页面发出整页刷新，可能打断提交后的客户端跳转。
 * 因此这里核对真实结果：等待跳转，未出现时直接访问目标页并确认会话已建立。
 */
async function settle(page: Page, pattern: RegExp, fallbackPath: string) {
  if (await page.waitForURL(pattern, { timeout: 15_000 }).then(() => true).catch(() => false)) return true;
  await page.goto(fallbackPath);
  const url = new URL(page.url());
  return pattern.test(`${url.pathname}${url.search}`);
}

/** 通过真实注册表单创建普通账号；成功后处于登录态并停在 /account。 */
export async function registerThroughUi(page: Page, options: { nickname: string; password: string; email?: string; beforeSubmit?: (page: Page) => Promise<void> }) {
  const email = options.email ?? `${randomUUID()}@example.test`;
  await page.goto("/register");
  await expect(page.getByTestId("captcha-image")).toBeVisible();
  if (options.beforeSubmit) await options.beforeSubmit(page);
  await page.getByLabel("昵称", { exact: true }).fill(options.nickname);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  const submit = page.getByRole("button", { name: "创建账号", exact: true });
  // 表单在 loading/pending/无挑战时会静默忽略提交，因此先确认按钮可用再点击。
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // 重试时重新加载表单，避免停留在自动刷新失败的状态。
      await page.goto("/register");
      await expect(page.getByTestId("captcha-image")).toBeVisible({ timeout: 20_000 });
      await page.getByLabel("昵称", { exact: true }).fill(options.nickname);
      await page.getByLabel("邮箱", { exact: true }).fill(email);
      await page.getByLabel("密码", { exact: true }).fill(options.password);
    }
    await answerCaptcha(page);
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.url().includes("/api/v1/auth/register") && candidate.request().method() === "POST", { timeout: 25_000 }).catch(() => null),
      submit.click(),
    ]);
    if (response?.status() === 200) {
      if (!(await settle(page, /\/account$/, "/account"))) throw new Error("Registration succeeded but the session was not established");
      return email;
    }
    if (response?.status() === 409 && attempt > 0) {
      // 上一次尝试可能已在服务端建号（响应超时或丢失）；按产品提示改用登录确认并建立会话。
      await loginThroughUi(page, { email, password: options.password, expectUrl: /\/account$/, expectPath: "/account" });
      return email;
    }
    if (await retryable(response)) continue;
    throw new Error(`Registration failed with status ${response?.status()}`);
  }
  throw new Error("Registration did not complete after three attempts.");
}

/** 通过真实登录表单进入目标页面；与注册同样吸收可重试的失败。 */
export async function loginThroughUi(page: Page, options: { email: string; password: string; url?: string; expectUrl: RegExp; expectPath?: string }) {
  await page.goto(options.url ?? "/login");
  await expect(page.getByTestId("captcha-image")).toBeVisible();
  await page.getByLabel("邮箱", { exact: true }).fill(options.email);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  const submit = page.getByRole("button", { name: "登录账号", exact: true });
  const target = options.url ?? "/login";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await page.goto(target);
      await expect(page.getByTestId("captcha-image")).toBeVisible({ timeout: 20_000 });
      await page.getByLabel("邮箱", { exact: true }).fill(options.email);
      await page.getByLabel("密码", { exact: true }).fill(options.password);
    }
    await answerCaptcha(page);
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.url().includes("/api/v1/auth/login") && candidate.request().method() === "POST", { timeout: 15_000 }).catch(() => null),
      submit.click(),
    ]);
    if (response?.status() === 200) {
      if (!(await settle(page, options.expectUrl, options.expectPath ?? "/account"))) throw new Error("Login succeeded but the target page was not reachable");
      return;
    }
    if (await retryable(response)) continue;
    throw new Error(`Login failed with status ${response?.status()}`);
  }
  throw new Error("Login did not complete after three attempts.");
}

/** 边界状态（封禁/角色）按产品基线直接落到测试账号，不绕过任何业务入口的流程验证。 */
export async function patchAccount(email: string, patch: { status?: "normal" | "banned"; role?: "user" | "admin" }) {
  const pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  try {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      values.push(value);
      assignments.push(`${key}=$${values.length}`);
    }
    values.push(email);
    const result = await pool.query(`UPDATE users SET ${assignments.join(", ")} WHERE email_normalized=$${values.length}`, values);
    expect(result.rowCount).toBe(1);
  } finally {
    await pool.end();
  }
}
