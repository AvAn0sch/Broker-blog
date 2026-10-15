import { execFileSync } from "node:child_process";
import { run } from "./lib.mjs";

const command = process.argv[2];
const actions = { check: ["config", "--quiet"], up: ["up", "-d", "--build", "postgres", "web", "worker"], test: ["run", "--build", "--rm", "test"], stop: ["stop"] };
if (!actions[command]) throw new Error("Use check, up, test or stop.");
const env = { ...process.env };
env.TESTED_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
env.TESTED_DIRTY = String(Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)prototype"], { encoding: "utf8", windowsHide: true }).trim()));
await run("docker", ["compose", "--env-file", ".env.compose.local", "-f", "deploy/compose.yaml", ...actions[command]], { env });
