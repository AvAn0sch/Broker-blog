import { getEnvironment } from "@/config/env";
import { content } from "@/modules/content/http";
import { connection } from "next/server";

export const runtime = "nodejs";
export async function GET() {
  await connection();
  const origin = getEnvironment().APP_ORIGIN;
  const entries = await content().sitemapEntries();
  const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((entry) => `<url><loc>${escapeXml(origin)}/articles/${entry.id}</loc><lastmod>${entry.updatedAt}</lastmod></url>`).join("")}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
