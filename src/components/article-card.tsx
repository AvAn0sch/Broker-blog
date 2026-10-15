import type { ArticleCard as ArticleCardDto } from "@/modules/discovery/service";
import { Avatar } from "./avatar";
import { formatPublished } from "./dates";

/** 首页、标签页与作者主页共用的公开文章卡片：只展示公开版本字段。 */
export function ArticleCard({ article }: { article: ArticleCardDto }) {
  return (
    <article className="article-card" data-testid="article-card">
      <div className="byline">
        <a className="byline-author" href={`/users/${article.author.id}`}>
          <Avatar nickname={article.author.nickname} avatarMediaId={article.author.avatarMediaId} size="small" />
          {article.author.nickname}
        </a>
        <span className="separator" aria-hidden="true">·</span>
        <time dateTime={article.firstPublishedAt}>{formatPublished(article.firstPublishedAt)}</time>
        {article.featured && <span className="badge">精选</span>}
      </div>
      <h2><a href={`/articles/${article.id}`}>{article.title}</a></h2>
      {article.summary && <p className="card-summary">{article.summary}</p>}
      {article.tags.length > 0 && (
        <div className="tags">
          {article.tags.map((tag) => <a className="tag" key={tag.id} href={`/tags/${tag.slug}`}>{tag.name}</a>)}
        </div>
      )}
    </article>
  );
}
