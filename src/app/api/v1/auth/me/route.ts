import { AppError, apiResponse } from "@/contracts/errors";
import { identity, sessionToken } from "@/modules/identity/http";

export const runtime = "nodejs";
export async function GET() {
  return apiResponse(async () => {
    const user = await identity().readSession(await sessionToken());
    if (!user) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
    return { user };
  });
}
