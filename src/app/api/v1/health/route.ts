import { apiResponse, AppError } from "@/contracts/errors";
import { getPool } from "@/infrastructure/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return apiResponse(async () => {
    try { await getPool().query("SELECT id FROM jobs LIMIT 0"); }
    catch { throw new AppError("SERVICE_UNAVAILABLE", 503, "数据库结构尚未就绪。"); }
    return { status: "ready" };
  });
}
