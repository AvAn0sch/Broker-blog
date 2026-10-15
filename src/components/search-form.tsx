/** 顶栏搜索：纯 GET 表单，无脚本也可提交；范围控件按架构差异表移除，综合搜索在 C1 接入。 */
export function SearchForm() {
  return (
    <form className="header-search" role="search" aria-label="站内搜索" action="/search" method="get">
      <input type="search" name="q" maxLength={100} aria-label="搜索文章" placeholder="搜索文章…" />
      <button type="submit" aria-label="搜索">⌕</button>
    </form>
  );
}
