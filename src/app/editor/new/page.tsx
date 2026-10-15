import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "写文章 · Broker Blog" };

export default async function NewArticleEditor() {
  await pageUser({ returnTo: "/editor/new", banned: "blocked" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">COMPOSE</p>
      <h1>写下你的下一篇</h1>
      <p className="page-sub">让零散的想法，成为有价值的经验。</p>
      <section className="panel">
        <h2>编辑器即将就绪</h2>
        <p>Markdown 编辑、自动保存、本地恢复与版本管理将随创作功能开放。当前页面用于确认你的写作入口与账号状态，不会保存任何输入。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
