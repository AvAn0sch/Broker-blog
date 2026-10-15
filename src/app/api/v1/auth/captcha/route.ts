import { z } from "zod";
import { apiResponse } from "@/contracts/errors";
import { getEnvironment } from "@/config/env";
import { recordTestCaptcha } from "@/infrastructure/testing/captcha";
import { anonymousRequest, identity } from "@/modules/identity/http";
import { purposeSchema } from "@/modules/identity/policy";
import { readJson } from "@/modules/identity/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const browser = await anonymousRequest(request);
    const { purpose } = z.strictObject({ purpose: purposeSchema }).parse(await readJson(request));
    const { answer, ...challenge } = await identity().issueCaptcha(browser, purpose);
    if (getEnvironment().TEST_CONTROLS === "true") await recordTestCaptcha(challenge.challengeId, answer);
    return challenge;
  });
}
