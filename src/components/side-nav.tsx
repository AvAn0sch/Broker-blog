"use client";

import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "发现文章", icon: "◈" },
  { href: "/tags", label: "探索标签", icon: "＃" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-label">社区</div>
      <nav aria-label="侧栏导航">
        {links.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <a key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}>
              <span aria-hidden="true">{link.icon}</span>
              {link.label}
            </a>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <span className="tiny-label">MAKE IDEAS CONNECT.</span>
        <p>让经验流动，<br />让技术被看见。</p>
        <small>Broker Blog · 技术社区</small>
      </div>
    </aside>
  );
}
