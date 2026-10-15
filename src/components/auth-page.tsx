import { SiteHeader } from "./site-header";
import { AuthForm } from "./auth-form";
import { safeReturnTo } from "@/modules/identity/policy";

export function AuthPage({ purpose, returnTo }: { purpose: "login" | "register"; returnTo: unknown }) {
  const registering = purpose === "register";
  return <><SiteHeader /><main className="auth-layout">
    <section className="auth-intro"><p className="eyebrow">BROKER BLOG / COMMUNITY</p><h1>{registering ? <>让每一次实践，<br />都有所沉淀。</> : <>欢迎回来，<br />继续你的技术旅程。</>}</h1><p>记录思考，分享实践。<br />在这里，与同行一起探索。</p><div className="intro-decoration" aria-hidden="true"><span /><span /><span /></div><p className="intro-footnote">把值得分享的经验，留给下一位探索者。</p></section>
    <section className="auth-panel"><AuthForm purpose={purpose} returnTo={safeReturnTo(returnTo)} /></section>
  </main></>;
}
