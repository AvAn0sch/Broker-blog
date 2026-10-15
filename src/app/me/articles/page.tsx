import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "内容管理 · Broker Blog" };

export default async function MyArticles() {
  const user = await pageUser({ returnTo: "/me/articles" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">MY ARTICLES</p>
      <h1>内容管理</h1>
      <p className="page-sub">照顾每一个想法，从草稿到发布。</p>
      {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁，仅可查看本人已有内容与处理原因。</p>}
      <section className="panel">
        <h2>草稿与发布管理即将开放</h2>
        <p>草稿、已发布与已下架文章的列表、修订标识和复核状态将随创作功能上线。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
