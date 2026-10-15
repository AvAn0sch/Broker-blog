import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Broker Blog · 记录实践，与同行连接",
  description: "记录技术思考，分享实践经验，与同行一起探索。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 浏览器扩展或用户脚本会在水合前给根元素注入属性（例如 data-*-uid），
  // 使 React 报告属性与客户端不一致。根元素显式抑制该比较，让 DOM 结果保留；
  // 抑制只覆盖 <html> 自身的属性，子组件的水合校验仍然开启。
  return <html lang="zh-CN" suppressHydrationWarning><body><AppShell>{children}</AppShell></body></html>;
}
