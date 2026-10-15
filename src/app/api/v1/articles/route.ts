import { z } from "zod";
import { AppError, apiResponse } from "@/contracts/errors";
import { idempotencyKey } from "@/infrastructure/http/request";
import { content } from "@/modules/content/http";
import { contentPolicy, draftCreateSchema } from "@/modules/content/policy";
import { discovery } from "@/modules/discovery/http";
import { feedModes, type FeedMode } from "@/modules/discovery/policy";
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

/** Public feed: only published content, with stable latest/featured cursor ordering. */
export async function GET(request: Request) {
  return apiResponse(async () => {
    const query = new URL(request.url).searchParams;
    const requested = query.get("mode");
    if (requested && !(feedModes as readonly string[]).includes(requested)) throw new AppError("INVALID_REQUEST", 400, "列表类型无效，请使用 featured 或 latest。");
    const author = query.get("author");
    if (author && !z.uuid().safeParse(author).success) throw new AppError("INVALID_REQUEST", 400, "作者参数无效。");
    return discovery().listFeed({
      mode: (requested as FeedMode | null) ?? "latest",
      tagSlug: query.get("tag"),
      authorId: author,
      cursor: query.get("cursor"),
      limit: query.has("limit") ? Number(query.get("limit")) : undefined,
    });
  });
}
