import type { UserDto } from "./service";

export type MenuEntry = { key: string; label: string; href: string };

/**
 * P0 用户菜单（产品设计 4.1）：内容管理、我的收藏、我的举报、个人设置与退出。
 * 封禁账号仅保留只读入口（通知与本人记录），不提供写作、设置或管理入口；
 * 退出按钮由菜单单独渲染，不在这份纯函数里。
 */
export function userMenuEntries(user: UserDto): MenuEntry[] {
  const entries: MenuEntry[] = [
    { key: "notifications", label: "通知中心", href: "/notifications" },
    { key: "articles", label: "内容管理", href: "/me/articles" },
    { key: "bookmarks", label: "我的收藏", href: "/me/bookmarks" },
    { key: "reports", label: "我的举报", href: "/me/reports" },
  ];
  if (user.status === "normal") entries.push({ key: "settings", label: "个人设置", href: "/settings/profile" });
  if (user.role === "admin" && user.status === "normal") entries.push({ key: "admin", label: "管理后台", href: "/admin" });
  return entries;
}
