import { randomUUID } from "node:crypto";
import { AppError } from "../../contracts/errors";

/** Draft, media and future writes accept an optional submission key; without one each request is distinct. */
export function idempotencyKey(request: Request) {
  const header = request.headers.get("x-idempotency-key");
  if (!header) return randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(header)) throw new AppError("INVALID_REQUEST", 400, "提交标识格式无效。");
  return header;
}

/** Media is uploaded as a raw binary body; the declared content type is never trusted. */
export async function readBinaryBody(request: Request, maxBytes: number, tooLarge: { code: string; message: string } = { code: "REQUEST_TOO_LARGE", message: "提交内容过长。" }) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError(tooLarge.code, 413, tooLarge.message);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("MEDIA_EMPTY", 400, "上传内容为空。");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.length;
      if (total > maxBytes) { await reader.cancel(); throw new AppError(tooLarge.code, 413, tooLarge.message); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
