import { expect, test } from "@playwright/test";

test("ENV-01 / UI-01 environment entry is readable and keyboard accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把经验写下来/ })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "b· broker blog" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("搜索文章", { exact: true })).toBeFocused();
  const health = page.getByRole("link", { name: "检查服务连接 →" });
  await health.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/api\/health\/ready$/);
  await expect(page.locator("body")).toContainText('"status":"ready"');
});
