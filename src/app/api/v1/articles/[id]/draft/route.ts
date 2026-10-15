import { z } from "zod";
import { AppError, apiResponse } from "@/contracts/errors";
import { idempotencyKey } from "@/infrastructure/http/request";
import { content } from "@/modules/content/http";
import { contentPolicy, draftSaveSchema } from "@/modules/content/policy";
import { authenticatedTransaction, identity, sessionToken } from "@/modules/identity/http";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";

const articleIdOf = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new AppError("ARTICLE_NOT_FOUND", 404, "草稿不存在。");
  return id;
};

/** The author's own working draft; other accounts always receive 404. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const articleId = articleIdOf((await context.params).id);
    const viewer = await identity().readSession(await sessionToken());
    if (!viewer) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
    return { draft: await content().loadDraft({ viewerId: viewer.id, articleId }) };
  });
}

/** Versioned save: the request carries the base draft version and cannot overwrite newer text. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const actor = await authenticatedTransaction(request, { write: true }, async (_tx, user) => user);
    const articleId = articleIdOf((await context.params).id);
    const input = draftSaveSchema.parse(await readJson(request, contentPolicy.requestBytes));
    return content().saveDraft({ actorId: actor.id, articleId, idempotencyKey: idempotencyKey(request), ...input });
  });
}
