import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, normalizeError } from "@/contracts/errors";
import { identity, sessionToken } from "@/modules/identity/http";
import { media } from "@/modules/media/http";

export const runtime = "nodejs";

/** Controlled media read: authorization follows current references on every request. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId, "X-Content-Type-Options": "nosniff" };
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new AppError("MEDIA_NOT_FOUND", 404, "图片不存在或无权访问。");
    const viewer = await identity().readSession(await sessionToken());
    const file = await media().read({ mediaId: id, viewer });
    const payload = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return new Response(payload, { status: 200, headers: { ...headers, "Content-Type": file.mime, "Content-Length": String(file.bytes.length), "Content-Disposition": "inline" } });
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.status >= 500) console.error(JSON.stringify({ requestId, code: normalized.code }));
    return Response.json({ error: { code: normalized.code, message: normalized.message }, requestId }, { status: normalized.status, headers });
  }
}
