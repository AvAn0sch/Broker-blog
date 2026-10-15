import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "通知中心 · Broker Blog" };

export default async function Notifications() {
  const user = await pageUser({ returnTo: "/notifications" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">NOTIFICATIONS</p>
      <h1>通知中心</h1>
      <p className="page-sub">{user.nickname}，这里将汇集与你相关的讨论与动态。</p>
      {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁，仅可查看本人已有通知记录。</p>}
      <section className="panel">
        <h2>通知功能即将开放</h2>
        <p>回复、关注与治理结果的通知将随互动功能上线；届时这里会显示未读状态与历史消息，不会展示示例内容。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
