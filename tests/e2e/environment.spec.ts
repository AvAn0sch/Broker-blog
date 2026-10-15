import { expect, test } from "@playwright/test";

test("ENV-01 / UI-01 home feed is readable and keyboard accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /好想法，值得被连接/ })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "b· broker blog" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("搜索文章", { exact: true })).toBeFocused();
  // 首页分发入口可键盘访问；服务就绪由接口直接读取，首页不再承载环境入口。
  const tabs = page.getByRole("navigation", { name: "文章排序" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "精选文章" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "最新发布" })).toBeVisible();
  const ready = await page.request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({ status: "ready" });
});
