import { apiResponse } from "@/contracts/errors";
import { idempotencyKey } from "@/infrastructure/http/request";
import { articleIdOf, content } from "@/modules/content/http";
import { publishSchema } from "@/modules/content/policy";
import { authenticatedTransaction } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const articleId = articleIdOf((await context.params).id);
    const input = publishSchema.parse(await readJson(request, 2048));
    return content().publish({ actorId: actor.id, articleId, idempotencyKey: idempotencyKey(request), ...input });
  });
}
