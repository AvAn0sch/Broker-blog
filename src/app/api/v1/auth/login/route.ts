import { apiResponse } from "@/contracts/errors";
import { anonymousRequest, establishSession, identity, sessionToken } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const browser = await anonymousRequest(request);
    const session = await identity().login(await readJson(request), browser, await sessionToken());
    await establishSession(session);
    return { user: session.user };
  });
}
