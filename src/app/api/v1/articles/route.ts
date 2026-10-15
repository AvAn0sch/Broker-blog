import { apiResponse } from "@/contracts/errors";
import { idempotencyKey } from "@/infrastructure/http/request";
import { content } from "@/modules/content/http";
import { contentPolicy, draftCreateSchema } from "@/modules/content/policy";
import { authenticatedTransaction } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";

/** Creates a private draft; retrying with the same key returns the original article. */
export async function POST(request: Request) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const input = draftCreateSchema.parse(await readJson(request, contentPolicy.requestBytes));
    return content().createDraft({ actorId: actor.id, idempotencyKey: idempotencyKey(request), ...input });
  });
}
