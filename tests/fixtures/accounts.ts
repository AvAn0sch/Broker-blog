import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";

async function answerCaptcha(page: Page) {
  const image = page.getByTestId("captcha-image");
  // 失败重试后表单会自动刷新验证码；等待新图片渲染完成再读取挑战。
  await expect(image).toBeVisible();
  const id = await image.getAttribute("data-challenge-id");
  if (!id) throw new Error("Challenge not loaded.");
  await page.getByLabel("图形验证码", { exact: true }).fill(await readTestCaptcha(id));
}

/** 通过真实注册表单创建普通账号；成功后处于登录态并停在 /account。 */
export async function registerThroughUi(page: Page, options: { nickname: string; password: string }) {
  const email = `${randomUUID()}@example.test`;
  await page.goto("/register");
  await expect(page.getByTestId("captcha-image")).toBeVisible();
  await page.getByLabel("昵称", { exact: true }).fill(options.nickname);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  const submit = page.getByRole("button", { name: "创建账号", exact: true });
  // 并发密码哈希达到上限时服务器返回可重试 503；表单保留输入并刷新验证码，此处按提示重试。
  for (let attempt = 0; attempt < 3; attempt++) {
    await answerCaptcha(page);
    await submit.click();
    const outcome = await Promise.race([
      page.waitForURL(/\/account$/, { timeout: 30_000 }).then(() => "account" as const).catch(() => "none" as const),
      page.getByRole("form", { name: "创建账号" }).getByRole("alert").waitFor({ timeout: 30_000 }).then(() => "alert" as const).catch(() => "none" as const),
    ]);
    if (outcome === "account") return email;
    if (outcome === "none") throw new Error("Registration neither completed nor reported an error.");
  }
  throw new Error("Registration did not complete after three attempts.");
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
