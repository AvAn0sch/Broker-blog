import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly fieldErrors?: Record<string, string[]>) { super(message); }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return new AppError("VALIDATION_FAILED", 400, "请检查输入内容。", Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), ["字段格式不正确。"]])));
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return new AppError("RESOURCE_CONFLICT", 409, "记录已存在。请刷新后重试。");
  if (code === "23503") return new AppError("RELATION_CONFLICT", 409, "关联对象已变化。请刷新后重试。");
  if (code === "23514" || code === "22001") return new AppError("VALIDATION_FAILED", 400, "内容不符合字段规则。");
  if (["40001", "40P01", "55P03", "57014"].includes(code ?? "")) return new AppError("RETRYABLE_CONFLICT", 503, "操作暂时冲突，请重试。");
  if (["ECONNREFUSED", "ECONNRESET", "57P01", "53300"].includes(code ?? "")) return new AppError("SERVICE_UNAVAILABLE", 503, "服务暂时不可用，请稍后重试。");
  return new AppError("INTERNAL_ERROR", 500, "操作未完成，请稍后重试。");
}

export async function apiResponse(work: () => Promise<unknown>) {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try { return Response.json({ data: await work(), requestId }, { headers }); }
  catch (error) {
    const normalized = normalizeError(error);
    if (normalized.status >= 500) console.error(JSON.stringify({ requestId, code: normalized.code }));
    return Response.json({ error: { code: normalized.code, message: normalized.message, ...(normalized.fieldErrors ? { fieldErrors: normalized.fieldErrors } : {}) }, requestId }, { status: normalized.status, headers });
  }
}
