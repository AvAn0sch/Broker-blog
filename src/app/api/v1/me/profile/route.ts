import { apiResponse } from "@/contracts/errors";
import { profileSchema } from "@/modules/identity/profile";
import { authenticatedTransaction, profile } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";

/** 本人资料修改：仅正常账号可写，头像必须是本人已完成上传的媒体。 */
export async function PATCH(request: Request) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const input = profileSchema.parse(await readJson(request));
    return { profile: await profile().update({ actorId: actor.id, ...input }) };
  });
}
