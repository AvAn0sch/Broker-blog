import { expect, test, type Page } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { secretToken } from "../../src/modules/identity/security";
import { registerThroughUi, patchAccount } from "../fixtures/accounts";

test.use({ trace: "off", screenshot: "off" });
const password = secretToken();
test.beforeAll(async () => {
  const pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  try { await pool.query("INSERT INTO tags (slug,name) VALUES ('b3-browser','浏览器发布标签') ON CONFLICT (slug) DO NOTHING"); } finally { await pool.end(); }
});
const body = (page: Page) => page.getByRole("textbox", { name: "Markdown 正文" });
async function compose(page: Page) {
  await registerThroughUi(page, { nickname: "发布流程作者", password });
  await page.goto("/editor/new"); await page.getByLabel("文章标题").fill("真实发布文章");
  await body(page).fill("## 第一节\n\n公开正文。\n\n```ts\nconst published = true;\n```\n\n## 第一节\n\n末尾正文。");
  await page.getByRole("button", { name: "发布文章", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布配置" }); await expect(dialog).toBeVisible();
  await dialog.getByLabel("文章摘要").fill("浏览器确认摘要"); await dialog.getByLabel("浏览器发布标签", { exact: true }).check();
  await dialog.getByRole("button", { name: "保存并确认版本" }).click();
  await expect(dialog.getByRole("status")).toContainText("已保存草稿 v");
  return dialog;
}
test("B3 ARTICLE-01 OUTPUT-01 publish, private revision, update and confirmed delete with response loss", async ({ page, browser, baseURL }) => {
  test.slow();
  let dialog = await compose(page);
  await dialog.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByRole("heading", { name: "真实发布文章", exact: true })).toBeVisible();
  expect(await page.title()).toContain("真实发布文章");
  await expect(page.locator("#section-1")).toHaveText("第一节"); await expect(page.locator("#section-2")).toHaveText("第一节");
  if (await page.locator(".mobile-toc").isVisible()) { await page.locator(".mobile-toc summary").click(); await page.getByRole("navigation", { name: "移动文章目录" }).getByRole("link").last().click(); }
  else await page.getByRole("navigation", { name: "文章目录", exact: true }).getByRole("link").last().click();
  expect(new URL(page.url()).hash).toBe("#section-2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const first = (await (await page.request.get(`/api/v1/articles/${id}`)).json()).data.article;
  const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try { const staticPage = await noJs.newPage(); await staticPage.goto(`/articles/${id}`); await expect(staticPage.getByTestId("public-article")).toContainText("const published = true;"); } finally { await noJs.close(); }
  await page.goto(`/editor/${id}`); await expect(page.getByLabel("文章标题")).toHaveValue("真实发布文章");
  await body(page).fill("新的私有修订正文"); await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  expect((await (await page.request.get(`/api/v1/articles/${id}`)).json()).data.article.markdown).toBe(first.markdown);
  await page.goto("/me/articles?status=published"); const row = page.getByTestId("managed-article").filter({ hasText: "真实发布文章" });
  await expect(row).toContainText("有未发布修改"); await row.getByRole("link", { name: "编辑草稿" }).click();
  await page.getByRole("button", { name: "更新文章", exact: true }).click(); dialog = page.getByRole("dialog", { name: "发布配置" });
  await expect(dialog.getByLabel("浏览器发布标签", { exact: true })).toBeChecked(); await expect(dialog.getByLabel("文章摘要")).toHaveValue("浏览器确认摘要");
  await dialog.getByRole("button", { name: "保存并确认版本" }).click(); await dialog.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${id}$`)); await expect(page.getByTestId("public-article")).toContainText("新的私有修订正文");
  const updated = (await (await page.request.get(`/api/v1/articles/${id}`)).json()).data.article; expect(updated.firstPublishedAt).toBe(first.firstPublishedAt);
  await page.goto("/me/articles?status=published"); await expect(row).not.toContainText("有未发布修改");
  await row.getByRole("button", { name: "删除文章" }).click(); const deletion = page.getByRole("dialog", { name: "确认删除文章" });
  await deletion.getByRole("button", { name: "取消", exact: true }).click(); expect((await page.request.get(`/api/v1/articles/${id}`)).status()).toBe(200);
  await row.getByRole("button", { name: "删除文章" }).click();
  await page.route(`**/api/v1/articles/${id}`, async (route) => { if (route.request().method() !== "DELETE") return route.fallback(); await route.fetch(); await route.abort(); });
  await deletion.getByRole("button", { name: "确认删除", exact: true }).click(); await expect(deletion.getByRole("alert")).toContainText("重试");
  await page.unroute(`**/api/v1/articles/${id}`); await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(row).toHaveCount(0); expect((await page.request.get(`/api/v1/articles/${id}`)).status()).toBe(404);
  await page.goto(`/articles/${id}`); await expect(page.getByTestId("public-article")).toHaveCount(0);
});
test("B3 EDIT-03 a draft changed after confirmation cannot be published and banned owners retain read-only access", async ({ page }) => {
  test.slow(); const dialog = await compose(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const csrf = (await (await page.request.get("/api/v1/auth/context")).json()).data.csrfToken;
  const current = (await (await page.request.get(`/api/v1/articles/${id}/draft`)).json()).data.draft;
  const response = await page.request.patch(`/api/v1/articles/${id}/draft`, { headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf }, data: { baseDraftVersion: current.version, title: "另一窗口的标题", markdown: "另一窗口的未确认正文", summary: "", tagIds: current.tagIds } }); expect(response.status()).toBe(200);
  await dialog.getByRole("button", { name: "确认发布", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("草稿已变化");
  expect((await page.request.get(`/api/v1/articles/${id}`)).status()).toBe(404);
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(body(page)).toContainText("公开正文");
  const pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  let email = ""; try { email = (await pool.query("SELECT u.email_normalized FROM users u JOIN articles a ON a.author_id=u.id WHERE a.id=$1", [id])).rows[0].email_normalized; } finally { await pool.end(); }
  await patchAccount(email, { status: "banned" });
  await page.goto(`/editor/${id}`); await expect(page.getByRole("status")).toContainText("仅可查看本人已有内容");
  await expect(page.getByRole("textbox", { name: "Markdown 正文" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "另一窗口的标题", exact: true })).toBeVisible();
  await page.goto("/me/articles"); await expect(page.getByRole("button", { name: "删除文章" })).toHaveCount(0); await expect(page.getByRole("link", { name: "只读查看" })).toBeVisible();
});
test("B3 EDIT-01 a failed save prevents publish confirmation while preserving the input", async ({ page }) => {
  test.slow(); await registerThroughUi(page, { nickname: "失败保存作者", password }); await page.goto("/editor/new");
  await page.route("**/api/v1/articles**", (route) => ["POST", "PATCH"].includes(route.request().method()) ? route.abort() : route.fallback());
  await page.getByLabel("文章标题").fill("不能假发布"); await body(page).fill("保存失败也须保留的正文");
  await page.getByRole("button", { name: "发布文章", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "发布配置" });
  await dialog.getByLabel("浏览器发布标签", { exact: true }).check(); await dialog.getByRole("button", { name: "保存并确认版本" }).click();
  await expect(dialog.getByRole("alert")).toContainText("尚未成功保存"); await expect(dialog.getByRole("button", { name: "确认发布", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(body(page)).toContainText("保存失败也须保留的正文");
});
