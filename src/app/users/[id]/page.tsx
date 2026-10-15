import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { ArticleCard } from "@/components/article-card";
import { Avatar } from "@/components/avatar";
import { formatPublished } from "@/components/dates";
import { FeedPager } from "@/components/feed-pager";
import { discovery } from "@/modules/discovery/http";

const readAuthor = cache(async (id: string) => {
  await connection();
  try { return await discovery().loadAuthor({ id }); }
  catch (error) { if (error instanceof AppError && error.status === 404) notFound(); throw error; }
});

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const author = await readAuthor((await params).id);
  return { title: `${author.nickname} · Broker Blog`, description: author.bio || `${author.nickname} 的公开文章。` };
}

/** 作者主页：公开资料与已发布文章；关注关系与列表属于互动阶段。 */
export default async function AuthorPage({ params, searchParams }: Props) {
  const author = await readAuthor((await params).id);
  const page = await discovery().listFeed({ mode: "latest", authorId: author.id, cursor: (await searchParams).cursor ?? null });
  return (
    <div className="page-scaffold">
      <header className="profile-head">
        <Avatar nickname={author.nickname} avatarMediaId={author.avatarMediaId} size="large" alt={`${author.nickname} 的头像`} />
        <div>
          <p className="eyebrow">AUTHOR</p>
          <h1>{author.nickname}</h1>
          <p className="profile-bio">{author.bio || "这位作者还没有填写简介。"}</p>
          <p className="muted">{author.publishedCount} 篇公开文章 · 加入于 {formatPublished(author.joinedAt)}</p>
        </div>
      </header>
      {page.items.length === 0
        ? <section className="panel empty"><strong>还没有公开文章</strong><p>作者发布后，这里会按最新顺序展示。</p></section>
        : (
          <>
            <div className="feed">{page.items.map((article) => <ArticleCard key={article.id} article={article} />)}</div>
            <FeedPager nextCursor={page.nextCursor} basePath={`/users/${author.id}`} />
          </>
        )}
    </div>
  );
}
