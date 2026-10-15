import { apiResponse } from "@/contracts/errors";
import { discovery } from "@/modules/discovery/http";

export const runtime = "nodejs";

/** 公开作者资料与该作者的已发布文章；不含邮箱与账号状态。 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const { id } = await context.params;
    const author = await discovery().loadAuthor({ id });
    const page = await discovery().listFeed({ mode: "latest", authorId: author.id });
    return { author, items: page.items, nextCursor: page.nextCursor };
  });
}
