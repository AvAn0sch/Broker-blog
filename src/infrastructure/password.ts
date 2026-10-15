import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppError } from "../contracts/errors";
import { authPolicy } from "../modules/identity/policy";

const processState = globalThis as unknown as { brokerPasswordWork?: { active: number } };
const work = processState.brokerPasswordWork ??= { active: 0 };
async function derive(password: string, salt: Buffer) {
  // Reject excess concurrent work rather than retaining an unbounded password queue.
  if (work.active >= 2) throw new AppError("AUTH_BUSY", 503, "登录服务繁忙，请稍后重试。");
  work.active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, authPolicy.password, (error, key) => error ? reject(error) : resolve(key)));
  } finally { work.active--; }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${authPolicy.password.N}$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | undefined) {
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored ?? "");
  // Missing accounts and unusable fixture hashes still incur the real password cost.
  const key = await derive(password, Buffer.from(match?.[1] ?? "0".repeat(32), "hex"));
  return timingSafeEqual(key, Buffer.from(match?.[2] ?? "0".repeat(128), "hex")) && Boolean(match);
}
