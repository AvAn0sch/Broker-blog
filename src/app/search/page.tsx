export const metadata = { title: "搜索文章 · Broker Blog" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return (
    <div className="page-scaffold">
      <p className="eyebrow">SEARCH</p>
      <h1>搜索文章</h1>
      <p className="page-sub">按关键词找到你需要的技术经验。</p>
      <form className="panel page-search" role="search" aria-label="站内搜索" action="/search" method="get">
        <input type="search" name="q" defaultValue={query} maxLength={100} aria-label="搜索关键词" placeholder="输入关键词，如 PostgreSQL" />
        <button className="button" type="submit">搜索</button>
      </form>
      {query
        ? <p role="status" className="search-status">已收到关键词「{query}」。搜索结果服务将在发现功能开放后提供，当前不返回任何文章数据。</p>
        : <section className="panel"><h2>你正在研究什么？</h2><p>输入关键词开始搜索；标题、标签与正文的综合搜索将随发现功能开放。</p></section>}
    </div>
  );
}
