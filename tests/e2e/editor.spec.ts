import { expect, test, type Page } from "@playwright/test";
import { secretToken } from "../../src/modules/identity/security";
import { registerThroughUi } from "../fixtures/accounts";
import { pngBytes } from "../fixtures/images";

test.use({ trace: "off", screenshot: "off" });
const password = secretToken();

/** 只让草稿写入失败，读到服务器的请求仍可正常完成。 */
async function blockDraftWrites(page: Page) {
  await page.route("**/api/v1/articles**", (route) => {
    const method = route.request().method();
    const creating = method === "POST" && /\/api\/v1\/articles$/.test(new URL(route.request().url()).pathname);
    const saving = method === "PATCH";
    return creating || saving ? route.abort() : route.fallback();
  });
}

async function editorBody(page: Page) {
  return page.getByRole("textbox", { name: "Markdown 正文" });
}

async function unsavedGuardActive(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("B2 autosave, local backup, failed save and refresh recovery", async ({ page }) => {
  test.slow();
  await registerThroughUi(page, { nickname: "编辑成员", password });
  await page.goto("/editor/new");
  const body = await editorBody(page);
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");

  await page.getByLabel("文章标题").fill("第一篇编辑稿");
  await body.click();
  await page.keyboard.type("# 保存，不只是一个按钮\n\n编辑体验的起点，是让每一次输入都有去处。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "unsynced");
  expect(await unsavedGuardActive(page)).toBe(true);

  // 1 秒内写本地副本，停止输入 3 秒后保存到服务器。
  await expect(page.getByTestId("backup-state")).toContainText("已本地备份", { timeout: 5_000 });
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });
  expect(await unsavedGuardActive(page)).toBe(false);
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/);

  await page.reload();
  await expect(page.getByLabel("文章标题")).toHaveValue("第一篇编辑稿");
  await expect(await editorBody(page)).toContainText("保存，不只是一个按钮");

  // 断网：写入失败不得显示已同步，但本地副本仍然可用。
  await blockDraftWrites(page);
  await (await editorBody(page)).click();
  await page.keyboard.type("\n\n断网期间继续写的内容。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "failed", { timeout: 15_000 });
  await expect(page.getByTestId("backup-state")).toContainText("已本地备份");
  await expect(page.getByTestId("save-state")).not.toHaveAttribute("data-state", "synced");

  await page.reload();
  const recovery = page.getByRole("dialog", { name: "本地恢复" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "恢复此副本" }).first().click();
  await expect(await editorBody(page)).toContainText("断网期间继续写的内容");

  await page.unroute("**/api/v1/articles**");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });
  await page.reload();
  await expect(await editorBody(page)).toContainText("断网期间继续写的内容");
});

test("B2 conflicting windows keep both copies recoverable", async ({ page }) => {
  test.slow();
  await registerThroughUi(page, { nickname: "多窗成员", password });
  await page.goto("/editor/new");
  await page.getByLabel("文章标题").fill("双窗口草稿");
  await (await editorBody(page)).click();
  await page.keyboard.type("第一个窗口写入的内容。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });
  const draftUrl = page.url();

  // 同一浏览器的第二个窗口：cookie 共享，sessionStorage 与本地副本独立。
  const second = await page.context().newPage();
  try {
    await second.goto(draftUrl);
    await expect(second.getByLabel("文章标题")).toHaveValue("双窗口草稿");

    await (await editorBody(page)).click();
    await page.keyboard.type("\n\n第一个窗口追加的更新。");
    await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });

    await (await editorBody(second)).click();
    await second.keyboard.type("\n\n第二个窗口的本地修改。");
    await expect(second.getByTestId("save-state")).toHaveAttribute("data-state", "conflict", { timeout: 15_000 });
    await expect(second.getByRole("button", { name: "载入服务器版本" })).toBeVisible();

    await second.getByRole("button", { name: "载入服务器版本" }).click();
    await expect(await editorBody(second)).toContainText("第一个窗口追加的更新");
    await expect(second.getByTestId("save-state")).toHaveAttribute("data-state", "synced");

    // 冲突窗口的本地修改仍保留为可恢复副本，且不会被其他窗口覆盖。
    await second.reload();
    const recovery = second.getByRole("dialog", { name: "本地恢复" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "恢复此副本" })).toHaveCount(1);
    await recovery.getByRole("button", { name: "稍后处理" }).click();
  } finally { await second.close(); }

  await (await editorBody(page)).click();
  await page.keyboard.type("\n\n冲突之后第一个窗口继续编辑。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });
});

test("B2 image insertion and draft export use controlled media", async ({ page }) => {
  test.slow();
  await registerThroughUi(page, { nickname: "插图成员", password });
  await page.goto("/editor/new");
  await page.getByLabel("文章标题").fill("插图草稿");
  await (await editorBody(page)).click();
  await page.keyboard.type("正文先写一段。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });

  // 图片插入：走真实入口（按钮触发文件选择器），上传后写入 Markdown 引用。
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入图片" }).click();
  await (await chooser).setFiles({ name: "shot.png", mimeType: "image/png", buffer: pngBytes(6, 4) });
  await expect(page.locator("p.editor-note").first()).toContainText("已插入图片", { timeout: 20_000 });
  await expect(await editorBody(page)).toContainText("/api/v1/media/");
  const previewTab = page.getByRole("button", { name: "预览" });
  const image = page.getByTestId("editor-preview").locator("img").first();
  // 预览始终按受控地址渲染；窄视口下预览位于切换标签后，需要先切到预览再检查可见性。
  await expect(image).toHaveAttribute("src", /\/api\/v1\/media\//);
  if (await previewTab.isVisible()) {
    await previewTab.click();
    await expect(image).toBeVisible();
  }
  const mediaId = /\/api\/v1\/media\/([0-9a-f-]{36})/.exec((await image.getAttribute("src")) ?? "")?.[1];
  expect(mediaId).toBeTruthy();
  expect((await page.request.get(`/api/v1/media/${mediaId}`)).status()).toBe(200);

  // 导出：无头浏览器不派发 blob 下载事件，改为校验下载入口的目标与内容。
  await page.getByRole("button", { name: "导出草稿" }).click();
  const file = page.locator("a[download]").first();
  await expect(file).toHaveAttribute("download", /\.md$/);
  const href = await file.getAttribute("href");
  expect(href).toBeTruthy();
  const exported = await page.evaluate(async (target: string) => (await fetch(target)).text(), href!);
  expect(exported).toContain("插图草稿");
  expect(exported).toContain("正文先写一段。");
  expect(exported).toContain(mediaId!);
  await expect(page.getByRole("button", { name: "复制正文" })).toBeVisible();
});
