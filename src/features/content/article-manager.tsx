"use client";

import { useEffect, useRef, useState } from "react";

export type ManagedArticle = { id: string; title: string; status: string; stateVersion: number; draftVersion: number; hasUnpublishedChanges: boolean; takedownReason: string | null; reviewStatus: string | null };
const states: Record<string, string> = { draft: "草稿", published: "已发布", taken_down: "已下架" };
const reviews: Record<string, string> = { pending: "复核待处理", approved: "复核已通过", rejected: "复核已驳回", withdrawn: "复核已撤销", terminated: "复核已终止" };

function DeleteDialog({ article, onClose, onDeleted }: { article: ManagedArticle; onClose(): void; onDeleted(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function remove() {
    setBusy(true); setError("");
    try {
      const context = await fetch("/api/v1/auth/context", { cache: "no-store" });
      if (!context.ok) throw new Error("无法确认登录状态，请重试。");
      const csrf = (await context.json()).data.csrfToken;
      const response = await fetch(`/api/v1/articles/${article.id}`, { method: "DELETE", cache: "no-store", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "", "X-Idempotency-Key": key.current }, body: JSON.stringify({ stateVersion: article.stateVersion }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message ?? "删除未完成，请重试。");
      onDeleted();
    } catch (error) { setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "未能确认删除结果，请重试。重复提交不会重复删除。"); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="content-dialog" aria-labelledby="delete-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="delete-title">确认删除文章</h2><p>确定删除《{article.title || "无标题草稿"}》？删除后无法在界面恢复，文章将不再公开。</p>
    {error && <div role="alert" className="notice">{error} <a href="/me/articles">刷新列表</a></div>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "正在删除…" : "确认删除"}</button></div>
  </dialog>;
}

export function ArticleManager({ items, canWrite }: { items: ManagedArticle[]; canWrite: boolean }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [selected, setSelected] = useState<ManagedArticle | null>(null);
  const [notice, setNotice] = useState("");
  const visible = items.filter((item) => !removed.includes(item.id));
  return <>
    {notice && <p role="status">{notice}</p>}
    {visible.length === 0 ? <section className="panel"><h2>暂无文章</h2><p>这个分类还没有文章。</p>{canWrite && <a className="button" href="/editor/new">开始写文章</a>}</section> : <ul className="managed-articles">{visible.map((article) => <li className="panel managed-article" key={article.id} data-testid="managed-article" data-id={article.id}>
      <div><h2>{article.title || "无标题草稿"}</h2><p>{states[article.status]} · 草稿 v{article.draftVersion}{article.hasUnpublishedChanges && <strong className="revision-badge"> · 有未发布修改</strong>}</p>
        {article.takedownReason && <p>下架原因：{article.takedownReason}</p>}{article.reviewStatus && <p>{reviews[article.reviewStatus] ?? "复核状态已更新"}</p>}
      </div><div className="manage-actions">
        {article.status === "published" && <a className="button secondary compact" href={`/articles/${article.id}`}>查看公开文章</a>}
        <a className="button secondary compact" href={`/editor/${article.id}`}>{canWrite ? "编辑草稿" : "只读查看"}</a>
        {canWrite && <button type="button" className="quiet danger-text" onClick={() => setSelected(article)}>删除文章</button>}
      </div>
    </li>)}</ul>}
    {selected && <DeleteDialog article={selected} onClose={() => setSelected(null)} onDeleted={() => { setRemoved([...removed, selected.id]); setSelected(null); setNotice("文章已删除。"); }} />}
  </>;
}
