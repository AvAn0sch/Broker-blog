import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../../contracts/errors";
import { hashPassword } from "../../infrastructure/password";
import { withTransaction } from "../../infrastructure/db/transaction";
import { emailSchema, nicknameSchema, passwordSchema } from "./policy";

function requireLocalAdministration() {
  if (!["development", "test"].includes(process.env.APP_ENV ?? "")) throw new Error("Local synthetic account administration is disabled in production.");
}
const syntheticEmail = emailSchema.refine((email) => email.endsWith(".test"), "Use synthetic .test email addresses only.");
const administratorSchema = z.strictObject({ email: syntheticEmail, password: passwordSchema, nickname: nicknameSchema });
const resetSchema = z.strictObject({ operatorEmail: syntheticEmail, email: syntheticEmail, password: passwordSchema, reason: z.string().trim().min(2).max(200) });

export async function initializeAdministrator(pool: Pool, input: unknown) {
  requireLocalAdministration();
  const data = administratorSchema.parse(input);
  const hash = await hashPassword(data.password);
  return withTransaction(pool, async ({ client }) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('identity.initialize-administrator'))");
    const existing = await client.query("SELECT 1 FROM users WHERE role='admin' OR email_normalized=$1 LIMIT 1", [data.email]);
    if (existing.rowCount) throw new AppError("ADMIN_ALREADY_INITIALIZED", 409, "管理员已存在或邮箱已使用；不会更改已有账号。");
    const result = await client.query("INSERT INTO users (email_normalized,password_hash,nickname,role) VALUES ($1,$2,$3,'admin') RETURNING id", [data.email, hash, data.nickname]);
    const id = result.rows[0].id as string;
    await client.query("INSERT INTO audit_logs (actor_id,target_type,target_id,action,reason,request_id) VALUES ($1,'user',$1,'identity.admin-initialized','受限本地脚本初始化合成管理员',$2)", [id, randomUUID()]);
    return { id };
  });
}

export async function resetSyntheticPassword(pool: Pool, input: unknown) {
  requireLocalAdministration();
  const data = resetSchema.parse(input);
  const hash = await hashPassword(data.password);
  return withTransaction(pool, async ({ client }) => {
    const users = await client.query("SELECT id,email_normalized,role,status FROM users WHERE email_normalized=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE", [[data.email, data.operatorEmail]]);
    const operator = users.rows.find((user) => user.email_normalized === data.operatorEmail);
    const target = users.rows.find((user) => user.email_normalized === data.email);
    if (operator?.role !== "admin" || operator.status !== "normal") throw new AppError("FORBIDDEN", 403, "需要正常状态的本地管理员。");
    if (!target) throw new AppError("USER_NOT_FOUND", 404, "测试账号不存在。");
    await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [target.id, hash]);
    await client.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [target.id]);
    await client.query("INSERT INTO audit_logs (actor_id,target_type,target_id,action,reason,request_id) VALUES ($1,'user',$2,'identity.password-reset',$3,$4)", [operator.id, target.id, data.reason, randomUUID()]);
    return { reset: true };
  });
}
