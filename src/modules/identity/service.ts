import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import { systemClock, type Clock } from "../../infrastructure/clock";
import { generateCaptcha } from "../../infrastructure/captcha";
import { hashPassword, verifyPassword } from "../../infrastructure/password";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";
import { authPolicy, loginSchema, registerSchema, type purposeSchema } from "./policy";
import type { z } from "zod";
import { csrfToken, digest, equals, secretToken, tokenIsValid } from "./security";
import { limitAuthentication } from "./rate-limit";

export type UserDto = { id: string; email: string; nickname: string; bio: string; avatarMediaId: string | null; role: "user" | "admin"; status: "normal" | "banned" };
type UserRow = { id: string; email_normalized: string; nickname: string; bio: string; avatar_media_id: string | null; role: UserDto["role"]; status: UserDto["status"] };
type IdentityOptions = { pool: Pool; sessionSecret: string; captchaSecret: string; clock?: Clock };
type Purpose = z.infer<typeof purposeSchema>;
function userDto(row: UserRow): UserDto { return { id: row.id, email: row.email_normalized, nickname: row.nickname, bio: row.bio, avatarMediaId: row.avatar_media_id, role: row.role, status: row.status }; }
const unauthenticated = () => new AppError("UNAUTHENTICATED", 401, "登录已过期，请重新登录。");

export function identityService(options: IdentityOptions) {
  const { pool, sessionSecret, captchaSecret } = options;
  const clock = options.clock ?? systemClock;
  const sessionHash = (token: string) => digest(sessionSecret, "session-token", token);
  const browserHash = (token: string) => digest(captchaSecret, "captcha-browser", token);

  async function readSession(token: string | undefined): Promise<UserDto | null> {
    if (!tokenIsValid(token)) return null;
    const result = await pool.query(`SELECT u.id,u.email_normalized,u.nickname,u.bio,u.avatar_media_id,u.role,u.status FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2`, [sessionHash(token), clock.now()]);
    return result.rowCount ? userDto(result.rows[0]) : null;
  }

  /** Business writes call this inside their transaction; password reset takes the same user -> session locks. */
  async function requireActor(tx: Transaction, token: string | undefined, requirements: { write?: boolean; admin?: boolean; csrf?: string | null } = {}) {
    if (!tokenIsValid(token)) throw unauthenticated();
    const reference = await tx.client.query("SELECT user_id FROM sessions WHERE token_hash=$1", [sessionHash(token)]);
    if (!reference.rowCount) throw unauthenticated();
    const user = await tx.client.query<UserRow>("SELECT id,email_normalized,nickname,bio,avatar_media_id,role,status FROM users WHERE id=$1 FOR NO KEY UPDATE", [reference.rows[0].user_id]);
    const session = await tx.client.query("SELECT csrf_hash FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2 FOR UPDATE", [sessionHash(token), clock.now()]);
    if (!user.rowCount || !session.rowCount) throw unauthenticated();
    if (requirements.write && (!requirements.csrf || !equals(digest(sessionSecret, "csrf-token", requirements.csrf), session.rows[0].csrf_hash))) throw new AppError("CSRF_REJECTED", 403, "页面已过期，请刷新后重试。");
    if ((requirements.write || requirements.admin) && user.rows[0].status !== "normal") throw new AppError("ACCOUNT_BANNED", 403, "当前账号仅可查看已有内容。");
    if (requirements.admin && user.rows[0].role !== "admin") throw new AppError("FORBIDDEN", 403, "此页面仅限管理员访问。");
    return userDto(user.rows[0]);
  }

  async function issueCaptcha(browser: string, purpose: Purpose) {
    if (!tokenIsValid(browser)) throw new AppError("CSRF_REJECTED", 403, "请刷新页面后重试。");
    await limitAuthentication(pool, sessionSecret, clock, "captcha", browser);
    const challengeId = randomUUID();
    const generated = generateCaptcha();
    const expiresAt = new Date(clock.now().getTime() + authPolicy.captchaMs);
    await withTransaction(pool, async ({ client }) => {
      // Serialize even the first two requests when no challenge row exists yet.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`captcha:${browserHash(browser)}:${purpose}`]);
      await client.query("UPDATE captcha_challenges SET invalidated_at=$3 WHERE browser_binding_hash=$1 AND purpose=$2 AND invalidated_at IS NULL AND consumed_at IS NULL", [browserHash(browser), purpose, clock.now()]);
      await client.query("INSERT INTO captcha_challenges (id,browser_binding_hash,purpose,answer_hmac,expires_at) VALUES ($1,$2,$3,$4,$5)", [challengeId, browserHash(browser), purpose, digest(captchaSecret, `captcha-answer:${challengeId}`, generated.answer), expiresAt]);
    });
    return { challengeId, image: generated.image, expiresAt: expiresAt.toISOString(), answer: generated.answer };
  }

  async function consumeCaptcha(browser: string, purpose: Purpose, id: string, answer: string) {
    // Return the rejection, then throw outside the transaction: attempts/consumption must persist on failure.
    const rejection = await withTransaction(pool, async ({ client }) => {
      const result = await client.query("SELECT * FROM captcha_challenges WHERE id=$1 FOR UPDATE", [id]);
      const challenge = result.rows[0];
      if (!challenge || !tokenIsValid(browser) || !equals(challenge.browser_binding_hash, browserHash(browser)) || challenge.purpose !== purpose) return "CAPTCHA_INVALID";
      if (challenge.consumed_at || challenge.invalidated_at) return "CAPTCHA_INVALID";
      if (challenge.expires_at.getTime() <= clock.now().getTime()) return "CAPTCHA_EXPIRED";
      if (challenge.attempts >= authPolicy.captchaAttempts) return "CAPTCHA_EXHAUSTED";
      const correct = equals(challenge.answer_hmac, digest(captchaSecret, `captcha-answer:${id}`, answer.trim().toUpperCase()));
      await client.query("UPDATE captcha_challenges SET attempts=attempts+1,consumed_at=CASE WHEN $2 THEN $3 ELSE consumed_at END WHERE id=$1", [id, correct, clock.now()]);
      return correct ? null : (challenge.attempts + 1 >= authPolicy.captchaAttempts ? "CAPTCHA_EXHAUSTED" : "CAPTCHA_INCORRECT");
    });
    if (rejection) throw new AppError(rejection, 400, rejection === "CAPTCHA_EXPIRED" ? "图形验证码已过期，请刷新。" : rejection === "CAPTCHA_EXHAUSTED" ? "验证码尝试次数已用完，请刷新。" : "图形验证码不正确或已失效，请重试或刷新。");
  }

  async function insertSession(tx: Transaction, user: UserRow, previousToken?: string) {
    const token = secretToken();
    const csrf = csrfToken(sessionSecret, "session", token);
    const expiresAt = new Date(clock.now().getTime() + authPolicy.sessionMs);
    if (tokenIsValid(previousToken)) await tx.client.query("UPDATE sessions SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL", [sessionHash(previousToken), clock.now()]);
    await tx.client.query("INSERT INTO sessions (user_id,token_hash,csrf_hash,expires_at) VALUES ($1,$2,$3,$4)", [user.id, sessionHash(token), digest(sessionSecret, "csrf-token", csrf), expiresAt]);
    return { user: userDto(user), token, csrfToken: csrf, expiresAt };
  }

  async function register(input: unknown, browser: string, previousToken?: string) {
    const data = registerSchema.parse(input);
    await limitAuthentication(pool, sessionSecret, clock, "register", browser, data.email);
    await consumeCaptcha(browser, "register", data.challengeId, data.captcha);
    const hash = await hashPassword(data.password);
    return withTransaction(pool, async (tx) => {
      const result = await tx.client.query<UserRow>(`INSERT INTO users (email_normalized,password_hash,nickname) VALUES ($1,$2,$3)
        ON CONFLICT (email_normalized) DO NOTHING RETURNING id,email_normalized,nickname,role,status`, [data.email, hash, data.nickname]);
      if (!result.rowCount) throw new AppError("EMAIL_IN_USE", 409, "该邮箱已注册，请登录。", { email: ["该邮箱已注册。"] });
      return insertSession(tx, result.rows[0], previousToken);
    });
  }

  async function login(input: unknown, browser: string, previousToken?: string) {
    const data = loginSchema.parse(input);
    await limitAuthentication(pool, sessionSecret, clock, "login", browser, data.email);
    await consumeCaptcha(browser, "login", data.challengeId, data.captcha);
    const record = await pool.query("SELECT id,password_hash FROM users WHERE email_normalized=$1", [data.email]);
    const valid = await verifyPassword(data.password, record.rows[0]?.password_hash);
    if (!valid || !record.rowCount) throw new AppError("INVALID_CREDENTIALS", 401, "邮箱或密码不正确。请刷新验证码后重试。");
    return withTransaction(pool, async (tx) => {
      const current = await tx.client.query<UserRow & { password_hash: string }>("SELECT id,email_normalized,password_hash,nickname,role,status FROM users WHERE id=$1 FOR NO KEY UPDATE", [record.rows[0].id]);
      if (!current.rowCount || current.rows[0].password_hash !== record.rows[0].password_hash) throw unauthenticated();
      return insertSession(tx, current.rows[0], previousToken);
    });
  }

  async function logout(token: string | undefined, csrf: string | null) {
    if (!tokenIsValid(token)) return;
    await withTransaction(pool, async ({ client }) => {
      const result = await client.query("SELECT csrf_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", [sessionHash(token)]);
      if (!result.rowCount) return;
      if (!csrf || !equals(digest(sessionSecret, "csrf-token", csrf), result.rows[0].csrf_hash)) throw new AppError("CSRF_REJECTED", 403, "页面已过期，请刷新后重试。");
      await client.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE token_hash=$1", [sessionHash(token), clock.now()]);
    });
  }

  return { readSession, requireActor, issueCaptcha, consumeCaptcha, register, login, logout };
}
