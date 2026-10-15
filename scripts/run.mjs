import { mkdir } from "node:fs/promises";
import { loadEnvironment, runNode } from "./lib.mjs";

const action = process.argv[2];
const isTest = ["test-api", "test-e2e", "test-environment", "test-foundation", "test-auth", "test-cleanup"].includes(action);
loadEnvironment(isTest);
await runNode("node_modules/tsx/dist/cli.mjs", ["scripts/validate-environment.mjs"]);
process.env.NEXT_TELEMETRY_DISABLED = "1";
await mkdir(process.env.MEDIA_ROOT, { recursive: true });

const next = "node_modules/next/dist/bin/next";
const playwright = "node_modules/@playwright/test/cli.js";
const port = new URL(process.env.APP_ORIGIN).port || "3000";
const actions = {
  dev: [next, ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", port]],
  start: [next, ["start", "--hostname", process.env.APP_HOST ?? "127.0.0.1", "--port", port]],
  worker: ["node_modules/tsx/dist/cli.mjs", ["src/worker/index.ts"]],
  "worker-once": ["node_modules/tsx/dist/cli.mjs", ["src/worker/index.ts", "--once"]],
  migrate: ["node_modules/tsx/dist/cli.mjs", ["scripts/migrate.mjs"]],
  seed: ["node_modules/tsx/dist/cli.mjs", ["scripts/seed.mjs"]],
  accounts: ["node_modules/tsx/dist/cli.mjs", ["scripts/accounts.mjs", ...process.argv.slice(3)]],
  jobs: ["node_modules/tsx/dist/cli.mjs", ["scripts/jobs.mjs", ...process.argv.slice(3)]],
  "test-api": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs", "--project=api"]],
  "test-e2e": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs", "--project=desktop", "--project=mobile"]],
  "test-environment": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs"]],
  "test-foundation": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs", "--project=foundation"]],
  "test-auth": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs", "--project=auth", "--project=desktop", "--project=mobile"]],
  "test-cleanup": ["node_modules/tsx/dist/cli.mjs", ["scripts/test-run.mjs", "--cleanup", ...process.argv.slice(3)]],
  "browser-install": [playwright, ["install", "chromium"]],
};
if (!actions[action]) throw new Error(`Unknown action: ${action}`);
await runNode(...actions[action]);
