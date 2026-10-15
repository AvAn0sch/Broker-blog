"use client";
import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true); setError("");
    try {
      const context = await (await fetch("/api/v1/auth/context", { cache: "no-store" })).json();
      if (!context.data) throw new Error();
      const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": context.data.csrfToken ?? context.data.anonymousCsrfToken }, body: "{}" });
      if (!response.ok) throw new Error();
      window.location.assign("/login");
    } catch { setError("退出未完成，请重试。"); setPending(false); }
  }
  return <div><button className="button secondary" type="button" disabled={pending} onClick={() => void logout()}>{pending ? "正在退出…" : "退出登录"}</button>{error && <p role="alert" className="form-error">{error}</p>}</div>;
}
