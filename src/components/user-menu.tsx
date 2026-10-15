"use client";

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { MenuEntry } from "@/modules/identity/navigation";
import { LogoutButton } from "./logout-button";

type Props = { userId: string; nickname: string; initial: string; statusNote: string; entries: MenuEntry[] };

/**
 * 头像菜单（触屏与键盘，按架构基线不使用鼠标悬浮开关）：
 * 点击触发钮切换；ArrowDown 打开并聚焦首项；Escape 关闭并回到触发钮；
 * 焦点移出或点击菜单外区域时关闭。
 */
export function UserMenu({ userId, nickname, initial, statusNote, entries }: Props) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open && focusFirst) {
      dropdown.current?.querySelector<HTMLElement>("a,button")?.focus();
      setFocusFirst(false);
    }
  }, [open, focusFirst]);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown" && event.target === trigger.current) {
      event.preventDefault();
      setOpen(true);
      setFocusFirst(true);
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className="user-menu" ref={container} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button ref={trigger} type="button" className="user-menu-trigger" aria-label={`用户菜单（${nickname}）`} aria-expanded={open} aria-controls="user-dropdown" onClick={() => setOpen((value) => !value)}>
        {initial}
      </button>
      <nav id="user-dropdown" ref={dropdown} className="user-dropdown" aria-label="用户相关页面" hidden={!open} onClick={() => setOpen(false)}>
        <div className="user-menu-heading">
          <strong>{nickname}</strong>
          <small>{statusNote}</small>
        </div>
        {entries.map((entry) => (
          <a key={entry.key} href={entry.href}>
            {entry.label}
            <span aria-hidden="true">›</span>
          </a>
        ))}
        <div className="user-menu-divider" />
        <LogoutButton variant="menu" userId={userId} />
      </nav>
    </div>
  );
}
