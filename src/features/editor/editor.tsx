"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentPolicy } from "@/modules/content/policy";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";
import { claimEditorSession, tempDraftId, type EditorSession } from "./editor-session";
import { backupId, createBackupStore, type BackupRecord } from "./local-backup";
import { Markdown } from "./markdown";
import { createSaveScheduler, type EditorSaveState, type SaveOutcome, type SavePayload } from "./save-scheduler";

export type DraftView = { articleId: string; version: number; title: string; markdown: string; summary: string };

const STATE_LABEL: Record<EditorSaveState, string> = {
  synced: "✓ 已同步服务器",
  unsynced: "○ 有未同步修改",
  saving: "◌ 正在保存",
  failed: "! 保存失败，请重试；当前输入仍保留",
  conflict: "! 版本冲突，已暂停自动提交",
};
const UNSETTLED: EditorSaveState[] = ["unsynced", "saving", "failed", "conflict"];

export function DraftEditor({ mode, userId, draft }: { mode: "new" | "draft"; userId: string; draft?: DraftView }) {
  const [title, setTitle] = useState(draft?.title ?? "");
  const [markdown, setMarkdown] = useState(draft?.markdown ?? "");
  const [articleId, setArticleId] = useState<string | null>(draft?.articleId ?? null);
  const [saveState, setSaveState] = useState<EditorSaveState>("synced");
  const [backupNote, setBackupNote] = useState("尚未写入本地副本");
  const [backupFailed, setBackupFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [copies, setCopies] = useState<BackupRecord[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const pendingInput = useRef(false);

  const latest = useRef({ title: draft?.title ?? "", markdown: draft?.markdown ?? "" });
  const summary = useRef(draft?.summary ?? "");
  const article = useRef<string | null>(draft?.articleId ?? null);
  const session = useRef("");
  const draftKey = useRef(draft?.articleId ?? "");
  const csrf = useRef("");
  const keys = useRef(new Map<string, string>());
  const scheduler = useRef<ReturnType<typeof createSaveScheduler> | null>(null);
  const editor = useRef<CodeEditorHandle | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const store = useMemo(() => createBackupStore(), []);
  const lastVersion = useRef(draft?.version ?? 0);
  const inputSeen = useRef(false);

  const keyFor = useCallback((payload: SavePayload) => {
    const scope = `${article.current ?? "new"}:${payload.baseVersion}:${payload.revision}`;
    if (!keys.current.has(scope)) keys.current.set(scope, crypto.randomUUID());
    return keys.current.get(scope)!;
  }, []);

  const refreshCopies = useCallback(async () => {
    const found = await store.listForDraft(userId, draftKey.current).catch(() => [] as BackupRecord[]);
    setCopies(found.filter((copy) => copy.unsynced));
  }, [store, userId]);

  /** 临时草稿首次保存成功后，把本窗口副本迁移到真实文章键，保留文本与基础版本。 */
  const migrateBackup = useCallback(async (from: string, to: string) => {
    await store.move(backupId(userId, from, session.current), backupId(userId, to, session.current), to);
  }, [store, userId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let lease: EditorSession | undefined;
    void (async () => {
      lease = await claimEditorSession({ signal: controller.signal });
      if (cancelled) { lease.release(); return; }
      session.current = lease.id;
      draftKey.current = draft?.articleId ?? tempDraftId();
      const context = await fetch("/api/v1/auth/context", { cache: "no-store", signal: controller.signal }).then((response) => response.json()).catch(() => null);
      if (cancelled) return;
      csrf.current = context?.data?.csrfToken ?? context?.data?.anonymousCsrfToken ?? "";
      const found = await store.listForDraft(userId, draftKey.current).catch(() => [] as BackupRecord[]);
      if (cancelled) return;
      const unsynced = found.filter((copy) => copy.unsynced);
      setCopies(unsynced);
      setShowRecovery(unsynced.length > 0);
    })().catch(() => {
      if (!cancelled) { setBackupFailed(true); setBackupNote("本地备份初始化失败：请使用“导出草稿”保存内容"); }
    });
    return () => { cancelled = true; controller.abort(); lease?.release(); };
  }, [draft?.articleId, store, userId]);

  const performSave = useCallback(async (payload: SavePayload): Promise<SaveOutcome> => {
    const body = { title: payload.title, markdown: payload.markdown, summary: payload.summary };
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrf.current, "X-Idempotency-Key": keyFor(payload) };
    try {
      if (!article.current) {
        const response = await fetch("/api/v1/articles", { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
        if (response.status === 409) return { ok: false, kind: "conflict" };
        if (!response.ok) return { ok: false, kind: "failure" };
        const { draft: created, version } = (await response.json() as { data: { draft: DraftView; version: number } }).data;
        article.current = created.articleId;
        setArticleId(created.articleId);
        const previousKey = draftKey.current;
        draftKey.current = created.articleId;
        await migrateBackup(previousKey, created.articleId).catch(() => { setBackupFailed(true); setBackupNote("本地副本迁移失败：请导出当前内容"); });
        window.history.replaceState(null, "", `/editor/${created.articleId}`);
        if (created.version !== version) {
          setNotice("此次保存已确认，但草稿随后已在其他窗口更新。请先导出或复制本地修改，再载入服务器版本。");
          return { ok: false, kind: "conflict" };
        }
        return { ok: true, version };
      }
      const response = await fetch(`/api/v1/articles/${article.current}/draft`, { method: "PATCH", headers, body: JSON.stringify({ ...body, baseDraftVersion: payload.baseVersion }), cache: "no-store" });
      if (response.status === 409) {
        const failure = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        const reason = failure?.error?.code === "DRAFT_VERSION_CONFLICT" ? "草稿已在其他窗口更新" : "同一提交标识不能用于不同内容";
        setNotice(`${reason}：自动提交已暂停。请先导出或复制本地修改，再载入服务器版本。`);
        return { ok: false, kind: "conflict" };
      }
      if (!response.ok) return { ok: false, kind: "failure" };
      const { draft: saved, version } = (await response.json() as { data: { draft: DraftView; version: number } }).data;
      if (saved.version !== version) {
        setNotice("此次保存已确认，但草稿随后已在其他窗口更新。请先导出或复制本地修改，再载入服务器版本。");
        return { ok: false, kind: "conflict" };
      }
      return { ok: true, version };
    } catch { return { ok: false, kind: "failure" }; }
  }, [keyFor, migrateBackup]);

  useEffect(() => {
    const instance = createSaveScheduler({
      initialVersion: lastVersion.current,
      cadence: contentPolicy.autosave,
      snapshot: () => ({ title: latest.current.title, markdown: latest.current.markdown, summary: summary.current }),
      backup: async (payload) => {
        if (!session.current || !draftKey.current) throw new Error("Editor session is not ready.");
        await store.put({
          id: backupId(userId, draftKey.current, session.current), userId, draftId: draftKey.current, sessionId: session.current,
          title: payload.title, markdown: payload.markdown, summary: payload.summary,
          baseVersion: payload.baseVersion, unsynced: payload.unsynced, savedAt: Date.now(), origin: window.location.pathname,
        });
      },
      save: performSave,
      onState: setSaveState,
      onBackup: (result) => {
        setBackupFailed(!result.ok);
        setBackupNote(result.ok ? `已本地备份 ${new Date(result.at).toLocaleTimeString("zh-CN")}` : "本地备份失败：请立即用“导出草稿”保存内容");
      },
    });
    scheduler.current = instance;
    // 开发态严格模式会挂载两次，且输入可能落在两次挂载之间：只要已经发生过输入，
    // 新实例必须继续安排保存，不能把文本留在未同步状态。
    if (pendingInput.current || inputSeen.current) { pendingInput.current = false; instance.input(); }
    return () => { lastVersion.current = instance.version(); instance.destroy(); scheduler.current = null; };
  }, [draft?.version, performSave, store, userId]);

  useEffect(() => {
    function guard(event: BeforeUnloadEvent) { if (UNSETTLED.includes(saveState)) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saveState]);

  function changeTitle(next: string) {
    setTitle(next); latest.current = { ...latest.current, title: next };
    inputSeen.current = true;
    if (scheduler.current) scheduler.current.input(); else pendingInput.current = true;
  }
  function changeMarkdown(next: string) {
    setMarkdown(next); latest.current = { ...latest.current, markdown: next };
    inputSeen.current = true;
    if (scheduler.current) scheduler.current.input(); else pendingInput.current = true;
  }

  async function insertImage(file: File) {
    setUploadNote("正在上传图片…");
    try {
      const response = await fetch("/api/v1/media", {
        method: "POST", cache: "no-store", body: file,
        headers: { "Content-Type": file.type || "application/octet-stream", "X-CSRF-Token": csrf.current, "X-Idempotency-Key": crypto.randomUUID() },
      });
      const result = await response.json().catch(() => null) as { data?: { media: { id: string; mime: string } }; error?: { message?: string } } | null;
      if (!response.ok || !result?.data) { setUploadNote(result?.error?.message ?? "图片上传失败，请重试。"); return; }
      const alt = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "图片";
      const url = `/api/v1/media/${result.data.media.id}`;
      // 插入失败时不能提示已插入，必须把链接交回给用户。
      setUploadNote(editor.current?.insert(`\n![${alt}](${url})\n`) ? `已插入图片（${result.data.media.mime}）` : `图片已上传但未能插入，请手动引用：${url}`);
    } catch { setUploadNote("图片上传失败，请重试。"); }
  }

  async function loadServerVersion() {
    if (!article.current) { setNotice("当前还没有服务器草稿。"); return; }
    const instance = scheduler.current;
    if (!instance) return;
    const revision = instance.revision();
    if (!await instance.backupNow()) { setNotice("本地副本未能保存。请先复制或导出当前内容，再载入服务器版本。"); return; }
    try {
      const response = await fetch(`/api/v1/articles/${article.current}/draft`, { cache: "no-store" });
      if (!response.ok) { setNotice("无法读取服务器版本，请稍后重试。"); return; }
      const server = (await response.json() as { data: { draft: DraftView } }).data.draft;
      if (instance !== scheduler.current || revision !== instance.revision()) { setNotice("读取期间有新的本地输入，已保留当前文本。请再次选择载入服务器版本。"); return; }
      setTitle(server.title); setMarkdown(server.markdown);
      latest.current = { title: server.title, markdown: server.markdown };
      summary.current = server.summary;
      instance.adoptServer(server.version);
      keys.current.clear();
      setNotice("已载入服务器版本（v" + server.version + "）。本地修改仍保留在本地副本中，可随时导出。");
      await refreshCopies();
    } catch { setNotice("无法读取服务器版本，请稍后重试。"); }
  }

  function recover(copy: BackupRecord) {
    setTitle(copy.title); setMarkdown(copy.markdown);
    latest.current = { title: copy.title, markdown: copy.markdown };
    summary.current = copy.summary;
    setShowRecovery(false);
    setNotice(`已恢复 ${new Date(copy.savedAt).toLocaleString("zh-CN")} 的本地副本；保存后会写回服务器。`);
    scheduler.current?.input();
  }

  async function discard(copy: BackupRecord) {
    await store.remove(copy.id).catch(() => {});
    await refreshCopies();
  }

  function exportDraft() {
    const blob = new Blob([`# ${latest.current.title}\n\n${latest.current.markdown}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${latest.current.title.trim() || "draft"}.md`;
    // 挂载到文档后再点击，并保留片刻：立即移除锚点会取消尚未开始的下载。
    document.body.append(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1_000);
  }

  async function copyDraft() {
    try { await navigator.clipboard.writeText(`# ${latest.current.title}\n\n${latest.current.markdown}`); setNotice("已复制当前内容。"); }
    catch { setNotice("复制失败，请使用“导出草稿”。"); }
  }

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-status-group">
          <span className="editor-status" data-testid="save-state" data-state={saveState} role="status">{STATE_LABEL[saveState]}</span>
          <span className="editor-backup" data-testid="backup-state" data-failed={backupFailed ? "true" : "false"}>{backupNote}</span>
        </div>
        <div className="editor-actions">
          <button type="button" onClick={() => void scheduler.current?.saveNow()}>保存草稿</button>
          <button type="button" onClick={() => fileInput.current?.click()}>插入图片</button>
          <button type="button" onClick={exportDraft}>导出草稿</button>
          <button type="button" onClick={() => void copyDraft()}>复制正文</button>
          {saveState === "conflict" && <button type="button" className="primary" onClick={() => void loadServerVersion()}>载入服务器版本</button>}
          <button type="button" className="button primary" disabled title="发布将在内容发布阶段开放">发布文章</button>
        </div>
      </div>
      <input
        ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="image-input"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertImage(file); event.target.value = ""; }}
      />
      {uploadNote && <p className="editor-note" role="status">{uploadNote}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <input className="title-input" aria-label="文章标题" maxLength={contentPolicy.title.max} placeholder="请输入文章标题" value={title} onChange={(event) => changeTitle(event.target.value)} />
      <div className="mobile-preview-tabs">
        <button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")}>编辑</button>
        <button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}>预览</button>
      </div>
      <div className={`editor-grid pane-${pane}`}>
        <section className="editor-pane source-pane" aria-label="Markdown 编辑">
          <div className="editor-pane-head"><strong>Markdown</strong><span className="muted">{markdown.length} 字符</span></div>
          <CodeEditor value={markdown} onChange={changeMarkdown} label="Markdown 正文" handleRef={editor} />
        </section>
        <section className="editor-pane preview-pane" aria-label="阅读预览" data-testid="editor-preview">
          <div className="editor-pane-head"><strong>阅读预览</strong><span className="muted">与公开正文共用渲染规则</span></div>
          <Markdown content={markdown} />
        </section>
      </div>
      <p className="editor-note">
        草稿只在你的账号下可见：{articleId ? `服务器草稿 ${articleId.slice(0, 8)}…` : "尚未创建服务器草稿（首次自动保存时创建）"}。发布、摘要与标签配置将在内容发布阶段开放。
      </p>
      {showRecovery && (
        <div className="recovery" role="dialog" aria-label="本地恢复">
          <h2>发现未同步的本地副本</h2>
          <p>下列副本保存在本机浏览器中，可按需恢复；其他窗口的副本不会被覆盖或删除。</p>
          <ul>
            {copies.map((copy) => (
              <li key={copy.id}>
                <span>{new Date(copy.savedAt).toLocaleString("zh-CN")} · {copy.sessionId === session.current ? "本窗口" : "另一窗口"} · 基础版本 v{copy.baseVersion}</span>
                <button type="button" onClick={() => recover(copy)}>恢复此副本</button>
                <button type="button" className="quiet" onClick={() => void discard(copy)}>放弃</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setShowRecovery(false)}>稍后处理</button>
        </div>
      )}
    </div>
  );
}
