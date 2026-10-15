import { describe, expect, it } from "vitest";
import { authPolicy, emailSchema, passwordSchema, registerSchema, safeReturnTo } from "../../src/modules/identity/policy";
import { csrfToken, requireAnonymousCsrf, requireOrigin, secretToken, readJson } from "../../src/modules/identity/security";
import { generateCaptcha } from "../../src/infrastructure/captcha";
import { readTestCaptcha } from "../../src/infrastructure/testing/captcha";
import { parseEnvironment } from "../../src/config/env";

describe("AUTH-01 / SECURITY-01 authentication rules", () => {
  it("normalizes email and enforces password edges without trimming credentials", () => {
    expect(emailSchema.parse(" Person@Example.Test ")).toBe("person@example.test");
    for (const length of [12, 128]) expect(passwordSchema.parse(" ".repeat(length)).length).toBe(length);
    for (const length of [0, 11, 129]) expect(passwordSchema.safeParse("x".repeat(length)).success).toBe(false);
    expect(registerSchema.safeParse({ email: "person@example.test", password: "p".repeat(12), nickname: "测试", challengeId: "123", captcha: "ABC123", role: "admin" }).success).toBe(false);
    expect(authPolicy.captchaAttempts).toBe(5);
  });
  it("only accepts local return paths", () => {
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", "/login", ["/account"], null]) expect(safeReturnTo(value)).toBe("/account");
    expect(safeReturnTo("/account?tab=profile#name")).toBe("/account?tab=profile#name");
  });
  it("requires the exact configured Origin and a browser-bound pre-login CSRF token", () => {
    const secret = "s".repeat(64), browser = secretToken();
    expect(requireAnonymousCsrf(secret, browser, csrfToken(secret, "anonymous", browser))).toBe(browser);
    expect(() => requireAnonymousCsrf(secret, secretToken(), csrfToken(secret, "anonymous", browser))).toThrow();
    for (const origin of ["https://evil.test", "null", "https://app.test.evil.test"]) expect(() => requireOrigin(new Request("https://app.test", { headers: { origin } }), "https://app.test")).toThrow();
    expect(() => requireOrigin(new Request("https://app.test", { headers: { origin: "https://app.test" } }), "https://app.test")).not.toThrow();
  });
  it("rejects malformed, oversized and non-JSON input", async () => {
    await expect(readJson(new Request("http://local", { method: "POST", body: "{}" }))).rejects.toMatchObject({ status: 415 });
    await expect(readJson(new Request("http://local", { method: "POST", headers: { "Content-Type": "application/json" }, body: "broken" }))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request("http://local", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(8193) }))).rejects.toMatchObject({ status: 413 });
  });
  it("draws a raster challenge and disables the internal answer adapter outside a test run", async () => {
    const generated = generateCaptcha();
    const png = Buffer.from(generated.image.split(",")[1], "base64");
    expect(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
    expect(png.includes(Buffer.from(generated.answer))).toBe(false);
    await expect(readTestCaptcha("a".repeat(36))).rejects.toThrow("isolated test run");
  });
  it("requires a canonical origin and HTTPS for production cookies", () => {
    const valid = { APP_ENV: "production", APP_ORIGIN: "https://app.test", DATABASE_URL: "postgresql://role:private@localhost/db", MEDIA_ROOT: ".local/media", SESSION_SECRET: "s".repeat(64), CAPTCHA_SECRET: "c".repeat(64) };
    expect(parseEnvironment(valid).APP_ORIGIN).toBe("https://app.test");
    for (const APP_ORIGIN of ["http://app.test", "https://app.test/path", "https://user:pass@app.test", "https://app.test?x=1"]) expect(() => parseEnvironment({ ...valid, APP_ORIGIN })).toThrow("APP_ORIGIN");
  });
});
