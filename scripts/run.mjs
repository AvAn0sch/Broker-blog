import { mkdir } from "node:fs/promises";
import { loadEnvironment, runNode } from "./lib.mjs";

const action = process.argv[2];
const isTest = ["test-api", "test-e2e", "test-environment"].includes(action);
loadEnvironment(isTest);
process.env.NEXT_TELEMETRY_DISABLED = "1";
await mkdir(process.env.MEDIA_ROOT, { recursive: true });

const next = "node_modules/next/dist/bin/next";
const playwright = "node_modules/@playwright/test/cli.js";
const port = new URL(process.env.APP_ORIGIN).port || "3000";
const actions = {
  dev: [next, ["dev", "--hostname", "127.0.0.1", "--port", port]],
  start: [next, ["start", "--hostname", process.env.APP_HOST ?? "127.0.0.1", "--port", port]],
  worker: ["node_modules/tsx/dist/cli.mjs", ["src/worker/index.ts"]],
  migrate: ["node_modules/drizzle-kit/bin.cjs", ["migrate"]],
  "test-api": [playwright, ["test", "--project=api"]],
  "test-e2e": [playwright, ["test", "--project=desktop", "--project=mobile"]],
  "test-environment": [playwright, ["test"]],
  "browser-install": [playwright, ["install", "chromium"]],
};
if (!actions[action]) throw new Error(`Unknown action: ${action}`);
await runNode(...actions[action]);
