import { z } from "zod";
import { AppError } from "../../contracts/errors";

const cursorSchema = z.strictObject({ v: z.literal(1), mode: z.enum(["featured", "latest"]), scope: z.string().max(200), key: z.string().max(64), id: z.uuid() });
export type FeedCursor = z.infer<typeof cursorSchema>;

const tagCursorSchema = z.strictObject({ v: z.literal(1), kind: z.literal("tags"), name: z.string().max(40), id: z.uuid() });
export type TagCursor = z.infer<typeof tagCursorSchema>;

function decode(value: string): unknown {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new AppError("CURSOR_INVALID", 400, "分页位置无效，请从第一页重试。"); }
}

/**
 * 游标包含排序方式与查询摘要；变更搜索条件时回到第一页，
 * 而不是把另一个列表的游标用在当前查询上。
 */
export function decodeFeedCursor(value: string | undefined | null, expected: { mode: string; scope: string }): FeedCursor | null {
  if (!value) return null;
  const parsed = cursorSchema.safeParse(decode(value));
  if (!parsed.success) throw new AppError("CURSOR_INVALID", 400, "分页位置无效，请从第一页重试。");
  if (parsed.data.mode !== expected.mode || parsed.data.scope !== expected.scope) return null;
  return parsed.data;
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeTagCursor(value: string | undefined | null): TagCursor | null {
  if (!value) return null;
  const parsed = tagCursorSchema.safeParse(decode(value));
  if (!parsed.success) throw new AppError("CURSOR_INVALID", 400, "分页位置无效，请从第一页重试。");
  return parsed.data;
}

export function encodeTagCursor(cursor: TagCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
