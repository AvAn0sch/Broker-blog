import { connection } from "next/server";
import { FeedPager } from "@/components/feed-pager";
import { discovery } from "@/modules/discovery/http";

export const metadata = { title: "探索标签 · Broker Blog" };

/** 标签总览：包含停用标签与其公开文章数（真实计数）。 */
export default async function TagsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await connection();
  const page = await discovery().listTags({ cursor: (await searchParams).cursor ?? null });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">TOPICS</p>
      <h1>探索标签</h1>
      <p className="page-sub">在熟悉的领域深耕，也给新的兴趣一点空间。</p>
      {page.items.length === 0
        ? (
          <section className="panel empty">
            <strong>还没有可用标签</strong>
            <p>标签由社区治理维护；这里不会展示示例内容。</p>
          </section>
        )
        : (
          <div className="topic-grid">
            {page.items.map((tag) => (
              <a key={tag.id} className={`topic-card${tag.enabled ? "" : " topic-disabled"}`} href={`/tags/${tag.slug}`}>
                <span className="topic-name">{tag.name}</span>
                <span className="muted">{tag.publishedCount} 篇公开文章</span>
                {!tag.enabled && <span className="badge">已停用</span>}
              </a>
            ))}
          </div>
        )}
      <FeedPager nextCursor={page.nextCursor} basePath="/tags" />
    </div>
  );
}
