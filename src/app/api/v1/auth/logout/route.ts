import { apiResponse } from "@/contracts/errors";
import { getEnvironment } from "@/config/env";
import { anonymousRequest, clearSession, identity, sessionToken } from "@/modules/identity/http";
import { readJson, requireOrigin } from "@/modules/identity/security";
import { z } from "zod";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireOrigin(request, getEnvironment().APP_ORIGIN);
    z.strictObject({}).parse(await readJson(request));
    const token = await sessionToken();
    const service = identity();
    if (await service.readSession(token)) await service.logout(token, request.headers.get("x-csrf-token"));
    else await anonymousRequest(request);
    await clearSession();
    return { loggedOut: true };
  });
}
