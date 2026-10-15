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

async function copiesFor(page: Page, draftId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("broker-blog-editor", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ draftId: string; sessionId: string; markdown: string; unsynced: boolean }[]>((resolve, reject) => {
        const tx = db.transaction("copies", "readonly");
        const request = tx.objectStore("copies").getAll();
        tx.oncomplete = () => resolve(request.result.filter((copy) => copy.draftId === id));
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, draftId);
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

    // Pausing server saves must not stop local recovery for text entered after the conflict.
    await (await editorBody(second)).click();
    await second.keyboard.type("\n冲突后继续编辑的文字。");
    const draftId = new URL(draftUrl).pathname.split("/").at(-1)!;
    await expect.poll(async () => (await copiesFor(second, draftId)).some((copy) => copy.unsynced && copy.markdown.includes("冲突后继续编辑的文字"))).toBe(true);

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

test("B2 a response-loss replay cannot adopt another window's version and editing resumes after loading the server version", async ({ page }) => {
  test.slow();
  await registerThroughUi(page, { nickname: "重试成员", password });
  await page.goto("/editor/new");
  await page.getByLabel("文章标题").fill("保存重试");
  await (await editorBody(page)).click(); await page.keyboard.type("基础正文");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/);
  await page.reload();
  // A successful PATCH consumes revision 1's key before the later conflict/rebase.
  await (await editorBody(page)).click(); await page.keyboard.type("\n第一次成功保存。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const endpoint = `/api/v1/articles/${id}/draft`;
  let receiptVersion = 0;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const result = await (await route.fetch()).json();
    receiptVersion = result.data.version;
    const csrf = route.request().headers()["x-csrf-token"];
    const remote = await page.request.patch(endpoint, {
      headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf, "X-Idempotency-Key": crypto.randomUUID() },
      data: { baseDraftVersion: receiptVersion, title: "保存重试", markdown: "另一个窗口确认的新正文", summary: "" },
    });
    expect(remote.status()).toBe(200);
    await route.abort();
  });
  await (await editorBody(page)).click(); await page.keyboard.type("\n尚未收到响应的修改。");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "failed");
  await page.unroute(`**${endpoint}`);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "conflict");
  await expect(await editorBody(page)).toContainText("尚未收到响应的修改");
  const current = (await (await page.request.get(endpoint)).json()).data.draft;
  expect(current.version).toBe(receiptVersion + 1);
  expect(current.markdown === "另一个窗口确认的新正文").toBe(true);

  await page.getByRole("button", { name: "载入服务器版本" }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  await expect(await editorBody(page)).toContainText("另一个窗口确认的新正文");
  await (await editorBody(page)).click(); await page.keyboard.type("\n载入后继续编辑。");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  expect((await (await page.request.get(endpoint)).json()).data.draft.version).toBe(current.version + 1);
});

test("B2 a copied tab has a distinct live session and cannot overwrite the original local copy", async ({ page }) => {
  test.slow();
  await registerThroughUi(page, { nickname: "复制窗口成员", password });
  await page.goto("/editor/new");
  await page.getByLabel("文章标题").fill("复制窗口");
  await (await editorBody(page)).click(); await page.keyboard.type("已保存的正文。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "synced");
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/);
  const draftUrl = page.url(), draftId = new URL(draftUrl).pathname.split("/").at(-1)!;
  await blockDraftWrites(page);
  await (await editorBody(page)).click(); await page.keyboard.type("\n原窗口本地文字。");
  await expect.poll(async () => (await copiesFor(page, draftId)).some((copy) => copy.unsynced && copy.markdown.includes("原窗口本地文字"))).toBe(true);
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)!])));
  const firstId = storage["bb-editor-session"];
  const second = await page.context().newPage();
  try {
    await second.addInitScript((items) => { for (const [key, value] of Object.entries(items)) sessionStorage.setItem(key, value); }, storage);
    await blockDraftWrites(second);
    await second.goto(draftUrl);
    const recovery = second.getByRole("dialog", { name: "本地恢复" });
    await expect(recovery).toBeVisible(); await recovery.getByRole("button", { name: "稍后处理" }).click();
    expect(await second.evaluate(() => sessionStorage.getItem("bb-editor-session"))).not.toBe(firstId);
    await (await editorBody(second)).click(); await second.keyboard.type("\n复制窗口本地文字。");
    await expect.poll(async () => {
      const copies = await copiesFor(second, draftId);
      return copies.some((copy) => copy.sessionId === firstId && copy.markdown.includes("原窗口本地文字")) && copies.some((copy) => copy.sessionId !== firstId && copy.markdown.includes("复制窗口本地文字"));
    }).toBe(true);
  } finally { await second.close(); }
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
