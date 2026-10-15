import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { ArticleCard } from "@/components/article-card";
import { FeedPager } from "@/components/feed-pager";
import { discovery } from "@/modules/discovery/http";

const readTag = cache(async (slug: string) => {
  await connection();
  try { return await discovery().loadTag({ slug }); }
  catch (error) { if (error instanceof AppError && error.status === 404) notFound(); throw error; }
});

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cursor?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = await readTag((await params).slug);
  return { title: `${tag.name} · 标签 · Broker Blog`, description: `${tag.name} 标签下的公开文章。` };
}

/** 标签页：只展示已发布文章；停用标签的既有文章仍可读取。 */
export default async function TagPage({ params, searchParams }: Props) {
  const tag = await readTag((await params).slug);
  const page = await discovery().listFeed({ mode: "latest", tagSlug: tag.slug, cursor: (await searchParams).cursor ?? null });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">TOPIC</p>
      <h1>{tag.name}</h1>
      <p className="page-sub">
        {tag.publishedCount} 篇公开文章{tag.enabled ? "" : " · 该标签已停用，不再用于新发布或更新"}。
      </p>
      {page.items.length === 0
        ? <section className="panel empty"><strong>该标签下还没有公开文章</strong><p><a href="/tags">返回标签总览</a></p></section>
        : (
          <>
            <div className="feed">{page.items.map((article) => <ArticleCard key={article.id} article={article} />)}</div>
            <FeedPager nextCursor={page.nextCursor} basePath={`/tags/${tag.slug}`} />
          </>
        )}
    </div>
  );
}
