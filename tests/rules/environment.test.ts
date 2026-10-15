import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/config/env";

const valid = {
  APP_ENV: "test",
  APP_ORIGIN: "http://127.0.0.1:3100",
  DATABASE_URL: "postgresql://broker_test:private@127.0.0.1:55432/broker_blog_test",
  MEDIA_ROOT: ".local/media/test",
  SESSION_SECRET: "s".repeat(64),
  CAPTCHA_SECRET: "c".repeat(64),
};

describe("ENV-01 configuration boundaries", () => {
  it("accepts the PostgreSQL environment and resolves a private media directory", () => {
    expect(parseEnvironment(valid).MEDIA_ROOT).toBe(path.resolve(".local/media/test"));
  });
  it("rejects public media paths, including normalized traversal", () => {
    for (const MEDIA_ROOT of ["public", "public/media", "somewhere/../public/uploads"]) {
      expect(() => parseEnvironment({ ...valid, MEDIA_ROOT })).toThrow("outside public");
    }
  });
  it("rejects missing/placeholder secrets without printing their values", () => {
    expect(() => parseEnvironment({ ...valid, SESSION_SECRET: undefined })).toThrow("SESSION_SECRET");
    expect(() => parseEnvironment({ ...valid, SESSION_SECRET: "REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS" })).toThrow("Generate local secrets");
  });
  it("rejects a non-PostgreSQL database URL", () => {
    expect(() => parseEnvironment({ ...valid, DATABASE_URL: "https://example.test/private" })).toThrow("DATABASE_URL");
  });
  it("rejects unsafe schemas and non-test control configuration", () => {
    expect(() => parseEnvironment({ ...valid, DATABASE_SCHEMA: 'public;drop schema public' })).toThrow("DATABASE_SCHEMA");
    expect(() => parseEnvironment({ ...valid, APP_ENV: "production", TEST_CONTROLS: "true" })).toThrow("isolated test run");
    expect(() => parseEnvironment({ ...valid, TEST_RUN_ID: "a".repeat(32), DATABASE_SCHEMA: "public" })).toThrow("own test schema");
  });
});
