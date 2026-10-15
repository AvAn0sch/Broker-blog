import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "注册 · Broker Blog" };
export default async function Register({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  return <AuthPage purpose="register" returnTo={(await searchParams).returnTo} />;
}
