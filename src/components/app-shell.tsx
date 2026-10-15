import { identity, sessionToken } from "@/modules/identity/http";
import { userMenuEntries } from "@/modules/identity/navigation";
import { SearchForm } from "./search-form";
import { SideNav } from "./side-nav";
import { UserMenu } from "./user-menu";

/**
 * 全站骨架（原型：顶栏 + 侧栏 + 主内容）。会话只读自数据库 cookie，
 * 不在此设置任何 cookie；游客显示登录/注册，封禁账号不显示写作入口。
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const token = await sessionToken();
  const user = await identity().readSession(token);
  const composeVisible = !user || user.status === "normal";
  return (
    <>
      <header className="site-header">
        <a className="brand" href="/"><span className="brand-mark">b<span>·</span></span>broker <span className="brand-light">blog</span></a>
        <SearchForm />
        {composeVisible && <a className="button primary compose" href="/editor/new">＋ 写文章</a>}
        {user ? (
          <UserMenu
            userId={user.id}
            nickname={user.nickname}
            avatarMediaId={user.avatarMediaId}
            statusNote={user.status === "banned" ? "已封禁 · 仅可只读" : user.role === "admin" ? "管理员" : "社区成员"}
            entries={userMenuEntries(user)}
          />
        ) : (
          <nav className="header-account" aria-label="账号导航">
            <a href="/login">登录</a>
            <a className="button compact" href="/register">加入社区</a>
          </nav>
        )}
      </header>
      <div className="shell">
        <SideNav />
        <main>{children}</main>
      </div>
    </>
  );
}
