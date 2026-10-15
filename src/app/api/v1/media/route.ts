import { apiResponse } from "@/contracts/errors";
import { idempotencyKey, readBinaryBody } from "@/infrastructure/http/request";
import { authenticatedTransaction } from "@/modules/identity/http";
import { media, mediaPolicy } from "@/modules/media/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const bytes = await readBinaryBody(request, mediaPolicy.maxBytes, { code: "MEDIA_TOO_LARGE", message: `单张图片不能超过 ${Math.floor(mediaPolicy.maxBytes / 1048576)} MB。` });
    const result = await media().upload({ actorId: actor.id, idempotencyKey: idempotencyKey(request), bytes });
    return { media: result.media, replayed: result.replayed };
  });
}
