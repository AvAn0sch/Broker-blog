import { redirect } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { SiteHeader } from "@/components/site-header";
import { getPool } from "@/infrastructure/db/client";
import { withTransaction } from "@/infrastructure/db/transaction";
import { identity, sessionToken } from "@/modules/identity/http";

export const metadata = { title: "管理工作台 · Broker Blog" };
export default async function Admin() {
  const token = await sessionToken();
  try { await withTransaction(getPool(), (tx) => identity().requireActor(tx, token, { admin: true })); }
  catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login?returnTo=%2Fadmin");
    if (error instanceof AppError && error.status === 403) redirect("/account?notice=admin-only");
    throw error;
  }
  return <><SiteHeader /><main className="account-layout"><p className="eyebrow">COMMUNITY MANAGEMENT</p><h1>管理工作台</h1><section className="account-card"><h2>共建友好的交流空间</h2><p>内容与社区管理功能将陆续开放。</p><a href="/account">返回我的账号 →</a></section></main></>;
}
