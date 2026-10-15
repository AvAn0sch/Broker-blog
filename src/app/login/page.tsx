import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "登录 · Broker Blog" };
export default async function Login({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  return <AuthPage purpose="login" returnTo={(await searchParams).returnTo} />;
}
