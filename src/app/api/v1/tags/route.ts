import { apiResponse } from "@/contracts/errors";
import { content } from "@/modules/content/http";

export const runtime = "nodejs";
export async function GET() { return apiResponse(async () => ({ tags: await content().listTags() })); }
