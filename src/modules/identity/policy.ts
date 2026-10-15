import { z } from "zod";

// These costs and limits are identical in development, tests and production.
export const authPolicy = Object.freeze({
  password: { min: 12, max: 128, N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
  sessionMs: 7 * 24 * 60 * 60 * 1000,
  browserSeconds: 24 * 60 * 60,
  captchaMs: 10 * 60 * 1000,
  captchaAttempts: 5,
  limits: {
    captcha: { count: 20, ms: 10 * 60 * 1000 },
    register: { count: 5, ms: 60 * 60 * 1000 },
    login: { count: 10, ms: 15 * 60 * 1000 },
    global: { count: 100, ms: 60 * 1000 },
  },
});

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(authPolicy.password.min).max(authPolicy.password.max);
export const nicknameSchema = z.string().trim().min(2).max(30);
export const purposeSchema = z.enum(["register", "login"]);
const credentials = { email: emailSchema, password: z.string().min(1).max(authPolicy.password.max), challengeId: z.uuid(), captcha: z.string().min(1).max(32) };
export const loginSchema = z.strictObject(credentials);
export const registerSchema = z.strictObject({ ...credentials, password: passwordSchema, nickname: nicknameSchema });

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/account";
  try {
    const url = new URL(value, "https://return.invalid");
    if (url.origin !== "https://return.invalid" || ["/login", "/register"].includes(url.pathname)) return "/account";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/account"; }
}
