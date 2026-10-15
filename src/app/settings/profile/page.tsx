import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "个人设置 · Broker Blog" };

export default async function ProfileSettings() {
  const user = await pageUser({ returnTo: "/settings/profile", banned: "blocked" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">SETTINGS</p>
      <h1>个人设置</h1>
      <p className="page-sub">向社区介绍一下自己，{user.nickname}。</p>
      <section className="panel">
        <h2>资料编辑即将开放</h2>
        <p>头像、昵称与个人简介的修改将随资料功能上线；当前账号邮箱为 {user.email}，仅用作登录标识。</p>
        <a className="button secondary" href="/account">返回我的账号</a>
      </section>
    </div>
  );
}
