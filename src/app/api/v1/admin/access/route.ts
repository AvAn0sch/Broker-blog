import { apiResponse } from "@/contracts/errors";
import { authenticatedTransaction } from "@/modules/identity/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    return authenticatedTransaction(request, { admin: true }, async (_tx, user) => ({ user, access: "admin" }));
  });
}
