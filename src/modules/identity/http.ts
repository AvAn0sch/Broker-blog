import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnvironment } from "../../config/env";
import { getPool } from "../../infrastructure/db/client";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";
import { csrfToken, requireOrigin, secretToken, tokenIsValid, requireAnonymousCsrf } from "./security";
import { identityService, type UserDto } from "./service";
import { authPolicy } from "./policy";

export function identity() {
  const env = getEnvironment();
  return identityService({ pool: getPool(), sessionSecret: env.SESSION_SECRET, captchaSecret: env.CAPTCHA_SECRET });
}
export function cookieNames() {
  const prefix = new URL(getEnvironment().APP_ORIGIN).protocol === "https:" ? "__Host-" : "";
  return { browser: `${prefix}bb_browser`, session: `${prefix}bb_session` };
}
function cookieOptions() { return { httpOnly: true, secure: new URL(getEnvironment().APP_ORIGIN).protocol === "https:", sameSite: "lax" as const, path: "/" }; }
export async function sessionToken() { return (await cookies()).get(cookieNames().session)?.value; }
export async function browserContext() {
  const jar = await cookies();
  let browser = jar.get(cookieNames().browser)?.value;
  if (!tokenIsValid(browser)) {
    browser = secretToken();
    jar.set(cookieNames().browser, browser, { ...cookieOptions(), maxAge: authPolicy.browserSeconds });
  }
  const token = jar.get(cookieNames().session)?.value;
  const user = await identity().readSession(token);
  if (token && !user) jar.set(cookieNames().session, "", { ...cookieOptions(), maxAge: 0 });
  return { user, anonymousCsrfToken: csrfToken(getEnvironment().SESSION_SECRET, "anonymous", browser), csrfToken: user && token ? csrfToken(getEnvironment().SESSION_SECRET, "session", token) : null };
}
export async function anonymousRequest(request: Request) {
  requireOrigin(request, getEnvironment().APP_ORIGIN);
  return requireAnonymousCsrf(getEnvironment().SESSION_SECRET, (await cookies()).get(cookieNames().browser)?.value, request.headers.get("x-csrf-token"));
}
export async function establishSession(session: { token: string; expiresAt: Date }) {
  const jar = await cookies();
  jar.set(cookieNames().session, session.token, { ...cookieOptions(), expires: session.expiresAt });
  jar.set(cookieNames().browser, secretToken(), { ...cookieOptions(), maxAge: authPolicy.browserSeconds });
}
export async function clearSession() { (await cookies()).set(cookieNames().session, "", { ...cookieOptions(), maxAge: 0 }); }

/** Server pages gate read-only routes on the live session; write APIs must still use authenticatedTransaction. */
export async function pageUser(options: { returnTo: string; banned?: "view" | "blocked" }): Promise<UserDto> {
  const token = await sessionToken();
  const user = await identity().readSession(token);
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(options.returnTo)}`);
  if (options.banned === "blocked" && user.status === "banned") redirect("/account?notice=banned-write");
  return user;
}

/** Future business routes reuse this gate so authorization is inside their write transaction. */
export async function authenticatedTransaction<T>(request: Request, requirements: { write?: boolean; admin?: boolean }, work: (tx: Transaction, actor: UserDto) => Promise<T>) {
  if (requirements.write) requireOrigin(request, getEnvironment().APP_ORIGIN);
  const token = await sessionToken();
  return withTransaction(getPool(), async (tx) => {
    const actor = await identity().requireActor(tx, token, { ...requirements, csrf: request.headers.get("x-csrf-token") });
    return work(tx, actor);
  });
}
