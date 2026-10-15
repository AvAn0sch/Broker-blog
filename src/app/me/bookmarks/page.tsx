import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "我的收藏 · Broker Blog" };

export default async function MyBookmarks() {
  const user = await pageUser({ returnTo: "/me/bookmarks" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">BOOKMARKS</p>
      <h1>我的收藏</h1>
      <p className="page-sub">把值得再读的文章，留在这里。</p>
      {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁，仅可查看本人已有收藏记录。</p>}
      <section className="panel">
        <h2>收藏列表即将开放</h2>
        <p>私有收藏、取消收藏与失效内容提示将随互动功能上线；收藏仅本人可见。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
