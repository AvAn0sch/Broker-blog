import { identity, sessionToken } from "@/modules/identity/http";

export async function SiteHeader() {
  const token = await sessionToken();
  const user = await identity().readSession(token);
  return <header className="site-header"><a className="brand" href="/"><span className="brand-mark">b<span>·</span></span>broker <span className="brand-light">blog</span></a>
    <nav aria-label="账号导航">{user ? <a href="/account">{user.nickname} · 我的账号</a> : <><a href="/login">登录</a><a className="button compact" href="/register">加入社区</a></>}</nav>
  </header>;
}
