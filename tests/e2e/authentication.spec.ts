import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { secretToken } from "../../src/modules/identity/security";
import { loginThroughUi, registerThroughUi } from "../fixtures/accounts";

// Authentication requests and input values must not be saved in traces or failure screenshots.
test.use({ trace: "off", screenshot: "off" });
const password = secretToken();
test.afterEach(async ({ page }) => {
  await page.locator("#password,#captcha").evaluateAll((inputs) => { for (const input of inputs) (input as HTMLInputElement).value = ""; }).catch(() => {});
});
async function register(page: Page, target: string) {
  await registerThroughUi(page, {
    nickname: "浏览器成员",
    password,
    email: target,
    // 输入凭证前记录布局预览，并遮罩验证码图片。
    beforeSubmit: async (current) => { await current.screenshot({ path: test.info().outputPath("register-preview.png"), fullPage: true, mask: [current.getByTestId("captcha-image")], maskColor: "#e6eee7" }); },
  });
}

test("AUTH-01 / UI-01 real registration, reload, logout and login use the same persisted account", async ({ page }) => {
  // 注册与登录各含真实密码哈希，并与同轮其他项目的哈希并发共享服务进程；本条需要更长预算。
  test.slow();
  const target = `${randomUUID()}@example.test`;
  await register(page, target);
  await expect(page.getByRole("heading", { name: "你好，浏览器成员。" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(target, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginThroughUi(page, { email: target, password, url: "/login?returnTo=%2Faccount%3Ffrom%3Dlogin", expectUrl: /\/account\?from=login$/, expectPath: "/account?from=login" });
  await expect(page.getByText(target, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("AUTH-01 / UI-01 captcha refresh, error and network recovery stay usable by keyboard", async ({ page }) => {
  await page.goto("/login");
  const image = page.getByTestId("captcha-image");
  await expect(image).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("login-preview.png"), fullPage: true, mask: [image], maskColor: "#e6eee7" });
  const old = await image.getAttribute("data-challenge-id");
  const refresh = page.getByRole("button", { name: "刷新验证码" });
  await refresh.focus(); await page.keyboard.press("Enter");
  await expect(image).not.toHaveAttribute("data-challenge-id", old!);
  await page.getByLabel("邮箱", { exact: true }).fill(`${randomUUID()}@example.test`);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("图形验证码", { exact: true }).fill("WRONG!");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  const alert = page.getByRole("form", { name: "登录账号" }).getByRole("alert");
  await expect(alert).toContainText("图形验证码");
  await expect(page.getByRole("button", { name: "登录账号", exact: true })).toBeEnabled();
  await page.route("**/api/v1/auth/captcha", (route) => route.abort());
  await refresh.click();
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "登录账号", exact: true })).toBeDisabled();
  await page.unroute("**/api/v1/auth/captcha");
  await refresh.click();
  await expect(image).toBeVisible();
  await expect(page.getByRole("button", { name: "登录账号", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("AUTH-02 protected pages redirect guests and reject external return addresses", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin$/);
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.test");
  await expect(page.getByRole("link", { name: "去注册" })).toHaveAttribute("href", "/register?returnTo=%2Faccount");
});

test("AUTH-02 existing browser session reflects ban and role changes on refresh", async ({ page }) => {
  test.slow();
  const target = `${randomUUID()}@example.test`;
  await register(page, target);
  const pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  try {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\?notice=admin-only$/);
    await pool.query("UPDATE users SET status='banned' WHERE email_normalized=$1", [target]);
    await page.reload();
    await expect(page.getByText("已封禁 · 只读", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeEnabled();
    await pool.query("UPDATE users SET status='normal',role='admin' WHERE email_normalized=$1", [target]);
    await page.goto("/account");
    await page.getByRole("link", { name: "管理工作台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "管理工作台" })).toBeVisible();
    await pool.query("UPDATE users SET status='banned' WHERE email_normalized=$1", [target]);
    await page.reload();
    await expect(page).toHaveURL(/\/account\?notice=admin-only$/);
    await expect(page.getByRole("link", { name: "管理工作台" })).toHaveCount(0);
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally { await pool.end(); }
});
