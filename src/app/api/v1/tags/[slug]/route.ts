import { apiResponse } from "@/contracts/errors";
import { discovery } from "@/modules/discovery/http";

export const runtime = "nodejs";

/** 标签详情：停用标签仍可读取既有公开文章，只影响新发布与更新。 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return apiResponse(async () => {
    const { slug } = await context.params;
    const tag = await discovery().loadTag({ slug });
    const page = await discovery().listFeed({ mode: "latest", tagSlug: tag.slug });
    return { tag, items: page.items, nextCursor: page.nextCursor };
  });
}
