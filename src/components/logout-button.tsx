"use client";
import { useState } from "react";
import { createBackupStore } from "@/features/editor/local-backup";

export function LogoutButton({ variant = "standalone", userId }: { variant?: "standalone" | "menu"; userId?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true); setError("");
    try {
      const context = await (await fetch("/api/v1/auth/context", { cache: "no-store" })).json();
      if (!context.data) throw new Error();
      const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": context.data.csrfToken ?? context.data.anonymousCsrfToken }, body: "{}" });
      if (!response.ok) throw new Error();
      if (userId) {
        // 主动退出清理该账号的本地草稿副本；清理失败必须明确提示并阻止继续使用本机存储。
        try { await createBackupStore().clearUser(userId); }
        catch { setError("本地草稿副本清理失败：请勿在该浏览器登录其他账号，或手动清理浏览器存储。"); setPending(false); return; }
      }
      window.location.assign("/login");
    } catch { setError("退出未完成，请重试。"); setPending(false); }
  }
  const failure = error && <p role="alert" className="form-error">{error}</p>;
  return (
    <div>
      <button className={variant === "menu" ? "menu-logout" : "button secondary"} type="button" disabled={pending} onClick={() => void logout()}>{pending ? "正在退出…" : "退出登录"}</button>
      {failure}
    </div>
  );
}
