import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "我的举报 · Broker Blog" };

export default async function MyReports() {
  const user = await pageUser({ returnTo: "/me/reports" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">MY REPORTS</p>
      <h1>我的举报</h1>
      <p className="page-sub">查看你提交的举报及处理结果。</p>
      {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁，仅可查看本人已有举报记录与结果。</p>}
      <section className="panel">
        <h2>举报记录即将开放</h2>
        <p>举报提交、处理状态与结果说明将随治理功能上线。</p>
        <a className="button secondary" href="/">返回发现文章</a>
      </section>
    </div>
  );
}
