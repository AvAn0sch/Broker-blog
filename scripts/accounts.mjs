import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getEnvironment } from "../src/config/env.ts";
import { getPool } from "../src/infrastructure/db/client.ts";
import { initializeAdministrator, resetSyntheticPassword } from "../src/modules/identity/administration.ts";

if (getEnvironment().APP_ENV === "production") throw new Error("Local account scripts are disabled in production.");
const [action, flag, file, ...extra] = process.argv.slice(2);
if (!["init-admin", "reset-password"].includes(action) || flag !== "--input-file" || !file || extra.length) throw new Error("Use init-admin/reset-password --input-file .local/<private-file.json>; never put credentials in command arguments.");
const root = await realpath(path.resolve(".local"));
const target = await realpath(path.resolve(file));
const relative = path.relative(root, target);
if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || (await stat(target)).size > 4096) throw new Error("Input must be a small private file inside .local.");
const pool = getPool();
try {
  const input = JSON.parse(await readFile(target, "utf8"));
  if (action === "init-admin") await initializeAdministrator(pool, input);
  else await resetSyntheticPassword(pool, input);
  console.log(action === "init-admin" ? "Synthetic administrator initialized; existing accounts were preserved." : "Synthetic password changed; all previous sessions revoked.");
} catch (error) {
  console.error(JSON.stringify({ code: typeof error?.code === "string" ? error.code : "ACCOUNT_COMMAND_FAILED", message: "Account command failed. Check environment, input fields and existing account state." }));
  process.exitCode = 1;
} finally { await pool.end(); }
