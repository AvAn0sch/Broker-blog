import { apiResponse } from "@/contracts/errors";
import { idempotencyKey } from "@/infrastructure/http/request";
import { articleIdOf, content } from "@/modules/content/http";
import { deleteArticleSchema } from "@/modules/content/policy";
import { authenticatedTransaction } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => ({ article: await content().loadPublic(articleIdOf((await context.params).id)) }));
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const articleId = articleIdOf((await context.params).id);
    const input = deleteArticleSchema.parse(await readJson(request, 2048));
    return content().deleteArticle({ actorId: actor.id, articleId, idempotencyKey: idempotencyKey(request), ...input });
  });
}
