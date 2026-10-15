import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestRun, cleanupTestRun } from "../src/infrastructure/testing/run.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || process.env.APP_ENV !== "test") throw new Error("Load the dedicated test configuration first.");
if (process.argv[2] === "--cleanup") {
  const id = process.argv[3];
  if (!/^[a-f0-9]{32}$/.test(id ?? "")) throw new Error("Supply a recorded test run ID.");
  const manifest = JSON.parse(await readFile(path.resolve(".local/test-runs", id, "manifest.json"), "utf8"));
  await cleanupTestRun(connectionString, manifest);
  console.log(`Cleaned test run ${id}`);
  process.exit(0);
}
const run = await createTestRun(connectionString);
const reports = path.join(run.directory, "reports");
await mkdir(reports, { recursive: true });
const environment = { ...process.env, APP_ENV: "test", TEST_RUN_ID: run.id, DATABASE_SCHEMA: run.schema, TEST_CONTROLS: "true", MEDIA_ROOT: run.media, TEST_REPORT_DIR: reports };
// The application, internal captcha adapter and every worker inherit this run's namespace.
const started = new Date().toISOString();
console.log(`Test run: ${run.id}`);
let code = 1;
let cleanup = "not_attempted";
try {
  code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], { env: environment, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
} finally {
  try { await cleanupTestRun(connectionString, run); cleanup = "passed"; }
  catch { cleanup = "failed"; code = 1; console.error(`Cleanup failed for run ${run.id}; use pnpm test:cleanup ${run.id} after investigation.`); }
  let commit = process.env.TESTED_COMMIT ?? "unknown";
  let dirty = process.env.TESTED_DIRTY === undefined ? "unknown" : process.env.TESTED_DIRTY === "true";
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(); dirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)prototype"], { encoding: "utf8", windowsHide: true }).trim()); } catch {}
  let result = {};
  try { result = JSON.parse(await readFile(path.join(reports, "results.json"), "utf8")).stats; } catch {}
  if (!result || !result.expected || result.skipped || result.unexpected || result.flaky) code = 1;
  const summary = { runId: run.id, commit, dirty, started, ended: new Date().toISOString(), node: process.version, configurationVersion: "b2-v2", datasetVersion: "identity-media-editor-v2", browser: "chromium-1248 / 156.0.8078.4", result, exitCode: code, cleanup };
  await writeFile(path.join(reports, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(reports, "summary.md"), `# Foundation run ${run.id}\n\nCommit: ${commit}\n\nDirty: ${dirty}\n\nExit code: ${code}\n\nCleanup: ${cleanup}\n\nResults: ${JSON.stringify(result)}\n`);
  console.log(`Report: ${path.join(reports, "summary.json")} (cleanup: ${cleanup})`);
}
process.exitCode = code;
