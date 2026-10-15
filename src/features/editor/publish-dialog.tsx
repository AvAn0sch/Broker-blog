"use client";

import { useEffect, useRef, useState } from "react";
import { codePointLength } from "@/modules/content/policy";

export type PublishConfirmation = { version: number; revision: number; stateVersion: number };
export type EditorTag = { id: string; name: string; enabled: boolean };

export function PublishDialog({ summary, tagIds, tags, onSummary, onTags, onPrepare, onPublish, onClose }: {
  summary: string; tagIds: string[]; tags: EditorTag[];
  onSummary(value: string): void; onTags(value: string[]): void;
  onPrepare(): Promise<PublishConfirmation>; onPublish(confirmation: PublishConfirmation, key: string): Promise<void>; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState<PublishConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function prepare() {
    setBusy(true); setError("");
    try { setConfirmation(await onPrepare()); key.current = crypto.randomUUID(); }
    catch (error) { setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "无法确认保存结果，请重试。"); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!confirmation) return;
    setBusy(true); setError("");
    try { await onPublish(confirmation, key.current); }
    catch (error) { setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "未能确认发布结果，请重试。"); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="content-dialog" aria-labelledby="publish-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="publish-title">发布配置</h2>
    {confirmation ? <>
      <p role="status">已保存草稿 v{confirmation.version}。确认发布此版本；未发布的后续编辑不会自动公开。</p>
      <p>摘要：{summary}</p><p>标签：{tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name).join("、")}</p>
    </> : <>
      <div className="field"><label htmlFor="publish-summary">文章摘要</label><textarea id="publish-summary" value={summary} onChange={(event) => onSummary(event.target.value)} disabled={busy} rows={4} /><small>{codePointLength(summary)} / 200 字符，可修改自动生成的摘要。</small></div>
      <fieldset disabled={busy}><legend>标签（选择 1–3 个）</legend><div className="tag-options">{tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} disabled={!tag.enabled && !tagIds.includes(tag.id)} onChange={(event) => onTags(event.target.checked ? [...tagIds, tag.id] : tagIds.filter((id) => id !== tag.id))} />{tag.name}{!tag.enabled && "（已停用，请取消）"}</label>)}</div></fieldset>
      {tags.length === 0 && <p className="notice">暂无可用标签，请稍后再试。</p>}
    </>}
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button>
      {confirmation && <button type="button" className="button secondary" disabled={busy} onClick={() => { setConfirmation(null); setError(""); }}>返回配置</button>}
      <button type="button" className="button" disabled={busy || (!confirmation && (tagIds.length < 1 || tagIds.length > 3 || codePointLength(summary) > 200 || tags.some((tag) => tagIds.includes(tag.id) && !tag.enabled)))} onClick={() => void (confirmation ? publish() : prepare())}>{busy ? "正在处理…" : confirmation ? "确认发布" : "保存并确认版本"}</button>
    </div>
  </dialog>;
}
