import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../contracts/errors";

export function secretToken() { return randomBytes(32).toString("hex"); }
export function tokenIsValid(token: unknown): token is string { return typeof token === "string" && /^[a-f0-9]{64}$/.test(token); }
export function digest(secret: string, purpose: string, value: string) { return createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex"); }
export function equals(a: string, b: string) { return tokenIsValid(a) && tokenIsValid(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
export function csrfToken(secret: string, kind: "anonymous" | "session", token: string) { return digest(secret, `${kind}-csrf`, token); }

export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== new URL(origin).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("CSRF_REJECTED", 403, "请求来源无效，请刷新页面后重试。");
}
export function requireAnonymousCsrf(secret: string, browser: string | undefined, csrf: string | null) {
  if (!tokenIsValid(browser) || !csrf || !equals(csrfToken(secret, "anonymous", browser), csrf)) throw new AppError("CSRF_REJECTED", 403, "页面已过期，请刷新后重试。");
  return browser;
}

export async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new AppError("INVALID_REQUEST", 415, "请使用 JSON 提交表单。");
  if (Number(request.headers.get("content-length")) > 8192) throw new AppError("REQUEST_TOO_LARGE", 413, "提交内容过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_REQUEST", 400, "请求内容为空。");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8192) { await reader.cancel(); throw new AppError("REQUEST_TOO_LARGE", 413, "提交内容过长。"); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new AppError("INVALID_REQUEST", 400, "请求内容不是有效 JSON。"); }
  } finally { reader.releaseLock(); }
}
