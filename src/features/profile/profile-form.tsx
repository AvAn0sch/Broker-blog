"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";

type Profile = { id: string; nickname: string; bio: string; avatarMediaId: string | null };

/** 资料编辑：昵称与简介按字段边界校验，头像先上传受控媒体再随资料保存。 */
export function ProfileForm({ profile, email }: { profile: Profile; email: string }) {
  const router = useRouter();
  const [nickname, setNickname] = useState(profile.nickname);
  const [bio, setBio] = useState(profile.bio);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(profile.avatarMediaId);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const csrf = useRef("");

  useEffect(() => {
    void (async () => {
      const context = await fetch("/api/v1/auth/context", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
      csrf.current = context?.data?.csrfToken ?? "";
    })();
  }, []);

  async function upload(file: File) {
    setUploading(true); setMessage("");
    try {
      const response = await fetch("/api/v1/media", {
        method: "POST", cache: "no-store", body: file,
        headers: { "Content-Type": file.type || "application/octet-stream", "X-CSRF-Token": csrf.current, "X-Idempotency-Key": crypto.randomUUID() },
      });
      const result = await response.json().catch(() => null) as { data?: { media: { id: string } }; error?: { message?: string } } | null;
      if (!response.ok || !result?.data) { setMessage(result?.error?.message ?? "头像上传失败，请重试。"); return; }
      setAvatarMediaId(result.data.media.id);
      setState("idle");
      setMessage("头像已上传，保存资料后生效。");
    } catch { setMessage("头像上传失败，请重试。"); }
    finally { setUploading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving"); setMessage(""); setFieldErrors({});
    try {
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.current },
        body: JSON.stringify({ nickname, bio, avatarMediaId }),
      });
      const result = await response.json().catch(() => null) as { data?: { profile: Profile }; error?: { message?: string; fieldErrors?: Record<string, string[]> } } | null;
      if (!response.ok) {
        setState("failed");
        setFieldErrors(result?.error?.fieldErrors ?? {});
        setMessage(result?.error?.message ?? "保存失败，请重试。");
        return;
      }
      setState("saved");
      setMessage("资料已保存。");
      // 骨架中的昵称与头像来自会话，保存后刷新服务端渲染结果。
      router.refresh();
    } catch { setState("failed"); setMessage("连接中断，请重试。"); }
  }

  return (
    <section className="account-card profile-editor">
      <h2>公开资料</h2>
      <div className="profile-editor-head">
        <Avatar nickname={nickname} avatarMediaId={avatarMediaId} size="large" alt="当前头像" />
        <div className="profile-avatar-actions">
          <input
            ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="avatar-input"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? "正在上传…" : "更换头像"}</button>
          {avatarMediaId && (
            <button type="button" className="quiet" onClick={() => { setAvatarMediaId(null); setState("idle"); setMessage("已移除头像，保存资料后生效。"); }}>
              移除头像
            </button>
          )}
          <p className="field-hint">支持 JPEG、PNG、WebP，单张不超过 5 MB；未设置头像时显示昵称首字。</p>
        </div>
      </div>
      <form className="profile-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="profile-nickname">昵称</label>
          <input id="profile-nickname" name="nickname" minLength={2} maxLength={30} required value={nickname} aria-invalid={Boolean(fieldErrors.nickname)} aria-describedby="profile-nickname-hint" onChange={(event) => setNickname(event.target.value)} />
          <span className="field-hint" id="profile-nickname-hint">2–30 个字符；昵称可重复，用户 ID 才是稳定标识。</span>
          {fieldErrors.nickname && <span className="field-error">{fieldErrors.nickname.join(" ")}</span>}
        </div>
        <div className="field">
          <label htmlFor="profile-bio">个人简介</label>
          <textarea id="profile-bio" name="bio" rows={3} maxLength={200} value={bio} aria-invalid={Boolean(fieldErrors.bio)} placeholder="一句话介绍你的方向与实践" onChange={(event) => setBio(event.target.value)} />
          <span className="field-hint">最多 200 个字符，当前 {bio.length} 个。</span>
          {fieldErrors.bio && <span className="field-error">{fieldErrors.bio.join(" ")}</span>}
        </div>
        <div className="field">
          <label htmlFor="profile-email">邮箱</label>
          <input id="profile-email" value={email} readOnly />
          <span className="field-hint">邮箱仅用作登录标识，本篇不发送验证邮件，也不能在资料页修改。</span>
        </div>
        {message && <p role="status" className={state === "failed" ? "form-error" : "notice"}>{message}</p>}
        <div className="profile-form-actions">
          <button className="button" type="submit" disabled={state === "saving" || uploading}>{state === "saving" ? "正在保存…" : "保存资料"}</button>
          <a className="button secondary" href={`/users/${profile.id}`}>查看作者主页</a>
        </div>
      </form>
    </section>
  );
}
