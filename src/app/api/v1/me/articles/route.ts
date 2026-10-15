import { AppError, apiResponse } from "@/contracts/errors";
import { content } from "@/modules/content/http";
import { identity, sessionToken } from "@/modules/identity/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const viewer = await identity().readSession(await sessionToken());
    if (!viewer) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
    const query = new URL(request.url).searchParams;
    return content().listMine({ viewerId: viewer.id, status: query.get("status") ?? undefined, cursor: query.get("cursor") ?? undefined, limit: query.has("limit") ? Number(query.get("limit")) : undefined });
  });
}
