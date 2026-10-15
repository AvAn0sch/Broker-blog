import { createHmac } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../contracts/errors";
import type { Transaction } from "../../infrastructure/db/transaction";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new AppError("INVALID_REQUEST", 400, "请求必须使用有效 JSON。");
    const result = JSON.stringify(value);
    if (result === undefined) throw new AppError("INVALID_REQUEST", 400, "请求必须使用有效 JSON。");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

const receiptSchema = z.strictObject({ resourceId: z.uuid(), version: z.number().int().positive().optional() });
export type Receipt = z.infer<typeof receiptSchema>;
const commandSchema = z.object({ actorId: z.uuid(), operation: z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/), key: z.uuid(), hashSecret: z.string().min(32) });

export async function requireWritableActor(tx: Transaction, actorId: string) {
  // Compatible with foreign-key KEY SHARE locks held by concurrent idempotency inserts.
  const actor = await tx.client.query("SELECT status FROM users WHERE id = $1 FOR NO KEY UPDATE", [actorId]);
  if (!actor.rowCount) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
  if (actor.rows[0].status !== "normal") throw new AppError("ACCOUNT_BANNED", 403, "当前账号仅可查看已有内容。");
}

/** The caller owns the transaction; authorization is also run for a successful replay. */
export async function withIdempotency(tx: Transaction, command: { actorId: string; operation: string; key: string; request: JsonValue; hashSecret: string; authorize: (tx: Transaction) => Promise<void> }, work: (tx: Transaction) => Promise<Receipt>) {
  commandSchema.parse(command);
  const hash = createHmac("sha256", command.hashSecret).update(canonicalJson(command.request)).digest("hex");
  const values = [command.actorId, command.operation, command.key];
  await tx.client.query("INSERT INTO idempotency_keys (actor_id, operation, key, request_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [...values, hash]);
  const record = await tx.client.query("SELECT request_hash, result FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE", values);
  await command.authorize(tx);
  if (record.rows[0].request_hash !== hash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识不能用于不同内容。");
  if (record.rows[0].result !== null) return { receipt: receiptSchema.parse(record.rows[0].result), replayed: true };
  const receipt = receiptSchema.parse(await work(tx));
  await tx.client.query("UPDATE idempotency_keys SET result=$4::jsonb WHERE actor_id=$1 AND operation=$2 AND key=$3", [...values, JSON.stringify(receipt)]);
  return { receipt, replayed: false };
}
