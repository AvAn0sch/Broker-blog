import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { identity, sessionToken } from "@/modules/identity/http";

export const metadata = { title: "我的账号 · Broker Blog" };
export default async function Account({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const token = await sessionToken();
  const user = await identity().readSession(token);
  if (!user) redirect("/login?returnTo=%2Faccount");
  const notice = (await searchParams).notice;
  return <div className="account-layout"><p className="eyebrow">MY ACCOUNT</p><h1>你好，{user.nickname}。</h1><p>每一段经验，都值得被记录。</p>
    {user.status === "banned" && <p role="status" className="notice">当前账号已被封禁。你仍可阅读公开内容、查看本人已有记录及退出登录。</p>}
    {notice === "admin-only" && <p role="status" className="notice">当前账号无法访问管理工作台。</p>}
    {notice === "banned-write" && <p role="status" className="notice">当前账号已被封禁，无法创建或修改内容；你仍可查看公开内容与本人已有记录。</p>}
    <section className="account-card" aria-labelledby="account-title"><h2 id="account-title">账号信息</h2><dl><div><dt>昵称</dt><dd>{user.nickname}</dd></div><div><dt>邮箱</dt><dd>{user.email}</dd></div><div><dt>身份</dt><dd>{user.role === "admin" ? "管理员" : "社区成员"}</dd></div><div><dt>账号状态</dt><dd>{user.status === "normal" ? "正常" : "已封禁 · 只读"}</dd></div></dl>
    <div className="account-actions">{user.role === "admin" && user.status === "normal" && <a className="button" href="/admin">管理工作台</a>}<LogoutButton userId={user.id} /></div></section>
  </div>;
}
