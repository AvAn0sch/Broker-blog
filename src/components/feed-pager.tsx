/** 游标分页：只提供“下一页”，排序稳定且不重复已有条目。 */
export function FeedPager({ nextCursor, basePath, query }: { nextCursor: string | null; basePath: string; query?: Record<string, string | undefined> }) {
  if (!nextCursor) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
  params.set("cursor", nextCursor);
  return (
    <nav className="feed-pager" aria-label="列表分页">
      <a className="button secondary" href={`${basePath}?${params.toString()}`}>下一页 →</a>
    </nav>
  );
}
