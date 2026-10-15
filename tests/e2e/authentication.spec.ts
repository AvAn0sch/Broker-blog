import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { secretToken } from "../../src/modules/identity/security";

// Authentication requests and input values must not be saved in traces or failure screenshots.
test.use({ trace: "off", screenshot: "off" });
const password = secretToken();
test.afterEach(async ({ page }) => {
  await page.locator("#password,#captcha").evaluateAll((inputs) => { for (const input of inputs) (input as HTMLInputElement).value = ""; }).catch(() => {});
});
async function answer(page: Page) {
  const image = page.getByTestId("captcha-image");
  await expect(image).toBeVisible();
  expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 228)).toBe(true);
  const id = await image.getAttribute("data-challenge-id");
  if (!id) throw new Error("Challenge not loaded.");
  await page.getByLabel("图形验证码", { exact: true }).fill(await readTestCaptcha(id));
}
async function register(page: Page, target: string) {
  await page.goto("/register");
  await expect(page.getByTestId("captcha-image")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("register-preview.png"), fullPage: true, mask: [page.getByTestId("captcha-image")], maskColor: "#e6eee7" });
  await page.getByLabel("昵称", { exact: true }).fill("浏览器成员");
  await page.getByLabel("邮箱", { exact: true }).fill(target);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await answer(page);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test("AUTH-01 / UI-01 real registration, reload, logout and login use the same persisted account", async ({ page }) => {
  const target = `${randomUUID()}@example.test`;
  await register(page, target);
  await expect(page.getByRole("heading", { name: "你好，浏览器成员。" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(target, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login?returnTo=%2Faccount%3Ffrom%3Dlogin");
  await page.getByLabel("邮箱", { exact: true }).fill(target);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await answer(page);
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page).toHaveURL(/\/account\?from=login$/);
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
