export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "broker-blog" }, { headers: { "Cache-Control": "no-store" } });
}
