import { randomUUID } from "node:crypto";
import { AppError } from "../../contracts/errors";
import { getEnvironment } from "../../config/env";
import { getPool } from "../../infrastructure/db/client";
import { mediaPolicy } from "./policy";
import { mediaService } from "./service";

export function media() {
  const env = getEnvironment();
  return mediaService({ pool: getPool(), secret: env.SESSION_SECRET, root: env.MEDIA_ROOT });
}

/** Media is uploaded as a raw binary body; the declared content type is never trusted. */
export async function readBinaryBody(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError("MEDIA_TOO_LARGE", 413, `单张图片不能超过 ${Math.floor(maxBytes / 1048576)} MB。`);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("MEDIA_EMPTY", 400, "上传内容为空。");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.length;
      if (total > maxBytes) { await reader.cancel(); throw new AppError("MEDIA_TOO_LARGE", 413, `单张图片不能超过 ${Math.floor(maxBytes / 1048576)} MB。`); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

/** Upload idempotency is optional: without a key each request is treated as a new submission. */
export function idempotencyKey(request: Request) {
  const header = request.headers.get("x-idempotency-key");
  if (!header) return randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(header)) throw new AppError("INVALID_REQUEST", 400, "提交标识格式无效。");
  return header;
}

export { mediaPolicy };
