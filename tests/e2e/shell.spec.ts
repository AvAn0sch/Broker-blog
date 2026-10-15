import { expect, test, type Locator, type Page } from "@playwright/test";
import { patchAccount, registerThroughUi } from "../fixtures/accounts";
import { secretToken } from "../../src/modules/identity/security";

// Registration flows through this file enter credentials; keep them out of traces and screenshots.
test.use({ trace: "off", screenshot: "off" });
const password = secretToken();

/**
 * 开发模式服务端 HTML 先于客户端水合呈现；一次性按键可能在水合前丢失。
 * ArrowDown 打开菜单是幂等操作，用轮询确保水合完成后菜单确实打开。
 */
async function openUserMenu(page: Page, trigger: Locator) {
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await expect.poll(async () => {
    await page.keyboard.press("ArrowDown");
    return page.getByRole("navigation", { name: "用户相关页面" }).isVisible();
  }, { timeout: 20_000, intervals: [250, 500, 1000] }).toBe(true);
}

test("A4 / UI-01 guest shell exposes discovery, search, compose and sign-in entries only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "加入社区" })).toHaveAttribute("href", "/register");
  await expect(page.getByRole("button", { name: /用户菜单/ })).toHaveCount(0);

  // Writing entry routes guests through login and keeps the editor as the return target.
  const compose = page.getByRole("link", { name: "＋ 写文章" });
  await expect(compose).toHaveAttribute("href", "/editor/new");
  await compose.click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Feditor%2Fnew$/);
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fnotifications$/);

  // Sidebar discovery entries with the current-section marker.
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "侧栏导航" });
  const discover = sidebar.getByRole("link", { name: "发现文章" });
  await expect(discover).toHaveAttribute("href", "/");
  await expect(discover).toHaveAttribute("aria-current", "page");
  const topics = sidebar.getByRole("link", { name: "探索标签" });
  await expect(topics).toHaveAttribute("href", "/tags");
  await topics.click();
  await expect(page).toHaveURL(/\/tags$/);
  await expect(topics).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "探索标签" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回发现文章" })).toBeVisible();

  // Header search works by keyboard and lands on the honest search page.
  await page.goto("/");
  const search = page.getByLabel("搜索文章", { exact: true });
  await search.focus();
  await page.keyboard.type("postgres");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=postgres$/);
  await expect(page.getByRole("heading", { name: "搜索文章" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("postgres");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("shell-search-guest.png"), fullPage: true });
});

test("A4 / UI-01 member menu lists personal entries and closes by keyboard", async ({ page }) => {
  await registerThroughUi(page, { nickname: "导航成员", password });
  const trigger = page.getByRole("button", { name: /用户菜单（导航成员）/ });
  const dropdown = page.getByRole("navigation", { name: "用户相关页面" });

  await openUserMenu(page, trigger);
  await expect(dropdown.getByRole("link", { name: "通知中心" })).toBeFocused();
  for (const [label, href] of [["通知中心", "/notifications"], ["内容管理", "/me/articles"], ["我的收藏", "/me/bookmarks"], ["我的举报", "/me/reports"], ["个人设置", "/settings/profile"]] as const) {
    await expect(dropdown.getByRole("link", { name: label })).toHaveAttribute("href", href);
  }
  await expect(dropdown.getByRole("link", { name: "管理后台" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dropdown).toBeHidden();
  await expect(trigger).toBeFocused();

  // Click toggling is verified after hydration is proven by the keyboard open above.
  await trigger.click();
  await expect(dropdown).toBeVisible();
  await dropdown.getByRole("link", { name: "内容管理" }).click();
  await expect(page).toHaveURL(/\/me\/articles$/);
  await expect(page.getByRole("heading", { name: "内容管理" })).toBeVisible();

  for (const [path, title] of [["/notifications", "通知中心"], ["/me/bookmarks", "我的收藏"], ["/me/reports", "我的举报"], ["/settings/profile", "个人设置"], ["/editor/new", "写下你的下一篇"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }

  await page.goto("/");
  await openUserMenu(page, trigger);
  await dropdown.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /用户菜单/ })).toHaveCount(0);
});

test("A4 / AUTH-02 admin and banned states change the visible entries and gates", async ({ page }) => {
  const email = await registerThroughUi(page, { nickname: "状态成员", password });
  const trigger = page.getByRole("button", { name: /用户菜单（状态成员）/ });
  const dropdown = page.getByRole("navigation", { name: "用户相关页面" });

  // Active admin: console entry appears and the real admin page opens.
  await patchAccount(email, { role: "admin" });
  await page.goto("/");
  await openUserMenu(page, trigger);
  const consoleLink = dropdown.getByRole("link", { name: "管理后台" });
  await expect(consoleLink).toHaveAttribute("href", "/admin");
  await consoleLink.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "管理工作台" })).toBeVisible();

  // Banned: no compose, no settings or console entries, read-only note, own records stay reachable.
  await patchAccount(email, { status: "banned" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "＋ 写文章" })).toHaveCount(0);
  await openUserMenu(page, trigger);
  await expect(dropdown.getByRole("link", { name: "管理后台" })).toHaveCount(0);
  await expect(dropdown.getByRole("link", { name: "个人设置" })).toHaveCount(0);
  await expect(dropdown.getByText("已封禁 · 仅可只读")).toBeVisible();
  await dropdown.getByRole("link", { name: "内容管理" }).click();
  await expect(page).toHaveURL(/\/me\/articles$/);
  await expect(page.getByRole("status")).toContainText("已被封禁，仅可查看本人已有内容");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible();

  // Banned members are blocked from writing pages with a clear redirect.
  await page.goto("/editor/new");
  await expect(page).toHaveURL(/\/account\?notice=banned-write$/);
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/account\?notice=banned-write$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Banned members can still sign out from the menu.
  await openUserMenu(page, trigger);
  await dropdown.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
