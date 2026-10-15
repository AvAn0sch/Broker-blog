import { AppError, apiResponse } from "@/contracts/errors";
import { browserContext } from "@/modules/identity/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("CSRF_REJECTED", 403, "请从本站打开登录页面。");
    return browserContext();
  });
}
