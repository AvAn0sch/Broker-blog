import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Broker Blog · 开发环境",
  description: "Broker Blog 本地开发环境入口",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
