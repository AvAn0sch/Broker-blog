export const metadata = { title: "探索标签 · Broker Blog" };

export default function TagsPage() {
  return (
    <div className="page-scaffold">
      <p className="eyebrow">TOPICS</p>
      <h1>探索标签</h1>
      <p className="page-sub">在熟悉的领域深耕，也给新的兴趣一点空间。</p>
      <section className="panel">
        <h2>标签浏览即将开放</h2>
        <p>标签总览与标签下的文章列表将随内容发现功能上线；全站没有公开文章时，这里会展示明确的空状态，而不是示例内容。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
