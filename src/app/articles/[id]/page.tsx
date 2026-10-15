import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { Markdown } from "@/features/editor/markdown";
import { publicationMarkdown } from "@/modules/content/markdown";
import { content } from "@/modules/content/http";
import { getEnvironment } from "@/config/env";

const readArticle = cache(async (id: string) => {
  await connection();
  try { return await content().loadPublic(id); }
  catch (error) { if (error instanceof AppError && error.status === 404) notFound(); throw error; }
});
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await readArticle((await params).id);
  return { title: `${article.title} · Broker Blog`, description: article.summary, alternates: { canonical: `${getEnvironment().APP_ORIGIN}/articles/${article.id}` } };
}
export default async function ArticlePage({ params }: Props) {
  const article = await readArticle((await params).id);
  const headings = publicationMarkdown(article.markdown).headings;
  return <div className="article-layout">
    <article className="article-paper" data-testid="public-article">
      <p className="eyebrow">TECH NOTES</p><h1>{article.title}</h1>
      <div className="article-meta"><span>{article.author.nickname}</span><span>首次发布 <time dateTime={article.firstPublishedAt}>{new Date(article.firstPublishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}</time></span>{article.updatedAt !== article.firstPublishedAt && <span>更新于 <time dateTime={article.updatedAt}>{new Date(article.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}</time></span>}</div>
      <div className="article-tags">{article.tags.map((tag) => <span key={tag.id}>{tag.name}</span>)}</div>
      <p className="article-summary">{article.summary}</p>
      <details className="mobile-toc"><summary>文章目录</summary><nav aria-label="移动文章目录">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.title}</a>)}</nav></details>
      <Markdown content={article.markdown} kind="article" />
      <a className="quiet" href={`/articles/${article.id}`}>文章固定链接</a>
    </article>
    <aside className="article-toc panel"><h2>文章目录</h2><nav aria-label="文章目录">{headings.length ? headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.title}</a>) : <p>本文暂无章节标题。</p>}</nav></aside>
  </div>;
}
