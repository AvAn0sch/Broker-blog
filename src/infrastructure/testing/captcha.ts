import path from "node:path";
import { getEnvironment } from "../../config/env";

// Runtime-only test files must not become Turbopack build dependencies: observing
// the generated answers would reload the page that just requested a challenge.
const files = process.getBuiltinModule("node:fs/promises") as typeof import("node:fs/promises");

async function directory() {
  if (process.env.APP_ENV !== "test" || process.env.TEST_CONTROLS !== "true") throw new Error("Captcha test adapter requires an isolated test run.");
  const env = getEnvironment();
  if (env.APP_ENV !== "test" || env.TEST_CONTROLS !== "true" || !env.TEST_RUN_ID || env.DATABASE_SCHEMA !== `bbtest_${env.TEST_RUN_ID}`) throw new Error("Captcha test adapter requires an isolated test run.");
  const expected = path.resolve(".local/test-runs", env.TEST_RUN_ID, "media");
  if (env.MEDIA_ROOT !== expected || await files.realpath(expected) !== expected) throw new Error("Captcha test adapter path mismatch.");
  const manifest = JSON.parse(await files.readFile(path.join(expected, "..", "manifest.json"), "utf8"));
  if (manifest.id !== env.TEST_RUN_ID || manifest.schema !== env.DATABASE_SCHEMA) throw new Error("Captcha test adapter marker mismatch.");
  const folder = path.join(expected, ".captcha-adapter");
  await files.mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}
export async function recordTestCaptcha(id: string, answer: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid challenge ID.");
  await files.writeFile(path.join(await directory(), `${id}.json`), JSON.stringify({ answer }), { flag: "wx", mode: 0o600 });
}
export async function readTestCaptcha(id: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid challenge ID.");
  return JSON.parse(await files.readFile(path.join(await directory(), `${id}.json`), "utf8")).answer;
}
