import { connection } from "next/server";
import { ArticleCard } from "@/components/article-card";
import { FeedPager } from "@/components/feed-pager";
import { discovery } from "@/modules/discovery/http";
import type { FeedMode } from "@/modules/discovery/policy";

/** 首页：精选/最新切换、文章卡片、标签与写作入口；精选为空时回退最新。 */
export default async function Home({ searchParams }: { searchParams: Promise<{ feed?: string; cursor?: string }> }) {
  await connection();
  const query = await searchParams;
  const mode: FeedMode = query.feed === "latest" ? "latest" : "featured";
  const cursor = query.cursor ?? null;
  let page = await discovery().listFeed({ mode, cursor });
  let fellBack = false;
  if (mode === "featured" && !cursor && page.items.length === 0) {
    page = await discovery().listFeed({ mode: "latest" });
    fellBack = true;
  }
  return (
    <div className="home-feed">
      <section className="hero">
        <p className="eyebrow">A PLACE FOR BUILDERS</p>
        <h1>好想法，值得被连接。</h1>
        <p>记录技术实践，分享真实经验，和同行一起成长。</p>
        <a className="hero-link" href="/tags">发现你的下一个灵感 ↗</a>
      </section>
      <section className="feed-section">
        <div className="feed-head">
          <h2>发现文章 <span className="muted">从一个问题，遇见新的思路</span></h2>
          <a className="muted" href="/editor/new">写一篇文章 ↗</a>
        </div>
        <nav className="feed-tabs" aria-label="文章排序">
          <a href="/" aria-current={mode === "featured" ? "page" : undefined}>精选文章</a>
          <a href="/?feed=latest" aria-current={mode === "latest" ? "page" : undefined}>最新发布</a>
        </nav>
        {fellBack && <p className="notice" role="status">当前没有精选文章，先看最新发布。</p>}
        {page.items.length === 0
          ? (
            <section className="panel empty">
              <strong>还没有公开文章</strong>
              <p>成为第一个分享实践经验的人。</p>
              <a className="button" href="/editor/new">写第一篇文章</a>
            </section>
          )
          : (
            <>
              <div className="feed">{page.items.map((article) => <ArticleCard key={article.id} article={article} />)}</div>
              <FeedPager nextCursor={page.nextCursor} basePath="/" query={{ feed: mode === "latest" ? "latest" : undefined }} />
            </>
          )}
      </section>
    </div>
  );
}
