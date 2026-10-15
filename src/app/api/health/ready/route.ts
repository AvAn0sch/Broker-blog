import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { getEnvironment } from "@/config/env";
import { getPool } from "@/infrastructure/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getEnvironment();
    await getPool().query("SELECT id FROM jobs LIMIT 0");
    await access(env.MEDIA_ROOT, constants.R_OK | constants.W_OK);
    return Response.json({ status: "ready", database: "ok", media: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
