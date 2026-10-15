import { describe, expect, it, vi } from "vitest";
import { apiResponse, AppError, normalizeError } from "../../src/contracts/errors";
import { canonicalJson } from "../../src/modules/foundation/idempotency";
import { testControls } from "../../src/infrastructure/testing/controls";

describe("TXN-01 / SECURITY-01 foundation contracts", () => {
  it("canonicalizes object keys while preserving array order and rejects non-JSON numbers", () => {
    expect(canonicalJson({ z: [2, 1], a: { y: true, x: null } })).toBe(canonicalJson({ a: { x: null, y: true }, z: [2, 1] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(() => canonicalJson(Infinity)).toThrow(AppError);
  });
  it("normalizes database conflicts without exposing SQL or private input", () => {
    const error = normalizeError({ code: "23505", detail: "private article and password" });
    expect(error.status).toBe(409);
    expect(error.code).toBe("RESOURCE_CONFLICT");
    expect(error.message).not.toContain("private");
    expect(normalizeError({ code: "40P01" }).status).toBe(503);
  });
  it("returns the shared response envelope and server-generated request ID", async () => {
    const response = await apiResponse(async () => { throw new AppError("VERSION_CONFLICT", 409, "版本已变化。"); });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("hides unexpected exception details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await apiResponse(async () => { throw new Error("postgresql://private:password@host/database"); });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("password");
      expect(JSON.stringify(log.mock.calls)).not.toContain("password");
    } finally { log.mockRestore(); }
  });
  it("does not enable internal test controls in a development or production process", () => {
    expect(() => testControls()).toThrow("disabled");
  });
});
