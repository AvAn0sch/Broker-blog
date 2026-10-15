import { apiResponse } from "@/contracts/errors";
import { authenticatedTransaction } from "@/modules/identity/http";
import { idempotencyKey, media, mediaPolicy, readBinaryBody } from "@/modules/media/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const bytes = await readBinaryBody(request, mediaPolicy.maxBytes);
    const result = await media().upload({ actorId: actor.id, idempotencyKey: idempotencyKey(request), bytes });
    return { media: result.media, replayed: result.replayed };
  });
}
