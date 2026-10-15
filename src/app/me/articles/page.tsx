import { pageUser } from "@/modules/identity/http";
import { content } from "@/modules/content/http";
import { ArticleManager } from "@/features/content/article-manager";

export const metadata = { title: "内容管理 · Broker Blog" };

export default async function MyArticles({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const user = await pageUser({ returnTo: "/me/articles" });
  const query = await searchParams;
  const status = ["draft", "published", "taken_down"].includes(query.status ?? "") ? query.status! : "all";
  let result: Awaited<ReturnType<ReturnType<typeof content>["listMine"]>> | null = null;
  try { result = await content().listMine({ viewerId: user.id, status, cursor: query.cursor }); } catch { /* A safe retry is rendered below. */ }
  return (
    <div className="page-scaffold">
      <p className="eyebrow">MY ARTICLES</p>
      <h1>内容管理</h1>
      <p className="page-sub">照顾每一个想法，从草稿到发布。</p>
      {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁，仅可查看本人已有内容与处理原因。</p>}
      <nav className="management-tabs" aria-label="文章分类">{[["all", "全部"], ["draft", "草稿"], ["published", "已发布"], ["taken_down", "已下架"]].map(([value, label]) => <a key={value} href={`/me/articles?status=${value}`} aria-current={status === value ? "page" : undefined}>{label}</a>)}</nav>
      {result ? <><ArticleManager key={`${status}:${query.cursor ?? ""}`} items={result.items} canWrite={user.status === "normal"} />{result.nextCursor && <a className="button secondary" href={`/me/articles?status=${status}&cursor=${encodeURIComponent(result.nextCursor)}`}>下一页</a>}</> : <section className="panel" role="alert"><p>无法读取文章列表或分页位置已失效。</p><a href={`/me/articles?status=${status}`} className="button secondary">重新读取</a></section>}
    </div>
  );
}
