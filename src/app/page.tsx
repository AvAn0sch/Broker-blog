export default function Home() {
  return (
    <main>
      <a className="brand" href="/">b<span>·</span> broker blog</a>
      <p className="eyebrow">开发环境 · A1</p>
      <h1>从这里，开始构建。</h1>
      <p>项目基础已启动。接下来将逐步接入账号、文章创作与社区互动。</p>
      <a className="button" href="/api/health/ready">检查服务连接 →</a>
      <p className="note">当前页面用于确认开发环境，业务功能正在后续阶段实现。</p>
    </main>
  );
}
