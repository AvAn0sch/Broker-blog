"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Challenge = { challengeId: string; image: string; expiresAt: string };
type Failure = { message: string; fieldErrors?: Record<string, string[]> };

export function AuthForm({ purpose, returnTo }: { purpose: "login" | "register"; returnTo: string }) {
  const registering = purpose === "register";
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const csrf = useRef("");
  const captchaInput = useRef<HTMLInputElement>(null);
  const title = registering ? "创建账号" : "登录账号";

  async function refresh(signal?: AbortSignal) {
    setLoading(true); setChallenge(null);
    try {
      const contextResponse = await fetch("/api/v1/auth/context", { cache: "no-store", signal });
      const context = await contextResponse.json();
      if (!contextResponse.ok || !context.data) throw new Error(context.error?.message ?? "暂时无法连接，请重试。");
      if (signal?.aborted) return;
      csrf.current = context.data.anonymousCsrfToken;
      const response = await fetch("/api/v1/auth/captcha", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.current }, body: JSON.stringify({ purpose }), signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "验证码加载失败，请重试。");
      if (!signal?.aborted) { setChallenge(result.data); if (captchaInput.current) captchaInput.current.value = ""; }
    } catch (error) {
      if (!signal?.aborted) setFailure({ message: error instanceof Error ? error.message : "验证码加载失败，请重试。" });
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [purpose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || !challenge) return;
    setPending(true); setFailure(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/v1/auth/${purpose}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.current }, body: JSON.stringify({ email: data.get("email"), password: data.get("password"), ...(registering ? { nickname: data.get("nickname") } : {}), challengeId: challenge.challengeId, captcha: data.get("captcha") }) });
      const result = await response.json();
      if (!response.ok) { setFailure(result.error ?? { message: "操作未完成，请重试。" }); await refresh(); return; }
      window.location.assign(returnTo);
    } catch { setFailure({ message: "连接中断，请重试。若注册已成功，可前往登录。" }); await refresh(); }
    finally { setPending(false); }
  }

  const fieldError = (name: string) => failure?.fieldErrors?.[name] ? <span className="field-error" id={`${name}-error`}>{failure.fieldErrors[name].join(" ")}</span> : null;
  return <form className="auth-form" onSubmit={submit} aria-label={title}>
    <h2>{title}</h2>
    {registering && <div className="field"><label htmlFor="nickname">昵称</label><input id="nickname" name="nickname" autoComplete="nickname" minLength={2} maxLength={30} required aria-describedby="nickname-error" aria-invalid={Boolean(failure?.fieldErrors?.nickname)} placeholder="社区里怎么称呼你" />{fieldError("nickname")}</div>}
    <div className="field"><label htmlFor="email">邮箱</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required aria-describedby="email-error" aria-invalid={Boolean(failure?.fieldErrors?.email)} placeholder="you@example.com" />{fieldError("email")}</div>
    <div className="field"><label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} required aria-describedby={registering ? "password-hint password-error" : "password-error"} aria-invalid={Boolean(failure?.fieldErrors?.password)} />{registering && <span id="password-hint" className="field-hint">12–128 个字符，支持空格和符号。</span>}{fieldError("password")}</div>
    <div className="field"><label htmlFor="captcha">图形验证码</label><div className="captcha-display" aria-busy={loading}>
      {challenge ? <img src={challenge.image} width={228} height={64} alt="图形验证码，含六位字母或数字" data-testid="captcha-image" data-challenge-id={challenge.challengeId} /> : <span>{loading ? "正在加载验证码…" : "验证码暂不可用"}</span>}
      <button type="button" className="quiet" disabled={loading || pending} onClick={() => { setFailure(null); void refresh(); }}>刷新验证码</button>
    </div><input ref={captchaInput} id="captcha" name="captcha" autoComplete="off" spellCheck={false} minLength={1} maxLength={32} required placeholder="输入图中的六位字符" aria-describedby="captcha-hint" /><span className="field-hint" id="captcha-hint">不区分大小写，10 分钟内有效。</span></div>
    {failure && <p role="alert" className="form-error">{failure.message}</p>}
    <button className="button submit" type="submit" disabled={pending || loading || !challenge}>{pending ? "正在提交…" : title}</button>
    <p className="form-switch">{registering ? "已有账号？" : "还没有账号？"} <a href={`/${registering ? "login" : "register"}?returnTo=${encodeURIComponent(returnTo)}`}>{registering ? "去登录" : "去注册"} →</a></p>
    {registering && <p className="form-note">邮箱仅用作登录标识，本期不发送验证邮件。</p>}
  </form>;
}
