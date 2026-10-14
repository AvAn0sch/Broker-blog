import { access, writeFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { loadEnvironment } from "./lib.mjs";

loadEnvironment();
const { chromium } = await import("@playwright/test");
let failed = false;
function report(name, ok, detail) {
  console.log(`${ok ? "OK" : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
}
report("Node.js", process.version === "v22.23.2", process.version);
report("Configuration", true, "private local configuration loaded");
const probe = path.resolve(process.env.MEDIA_ROOT, `.write-probe-${process.pid}`);
try {
  await writeFile(probe, "probe", { flag: "wx" });
  await unlink(probe);
  report("Media", true, "read/write available outside public");
} catch { report("Media", false, "directory missing or not writable"); }
try {
  const executable = path.resolve(process.env.PG_BIN, process.platform === "win32" ? "postgres.exe" : "postgres");
  const version = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  report("Native PostgreSQL", version.includes("17.11"), version);
} catch { report("Native PostgreSQL", false, "run pnpm db:install on Windows, or set PG_BIN"); }
try {
  await access(chromium.executablePath());
  report("Chromium", true, "pinned browser executable installed");
} catch {
  report("Chromium", false, "run pnpm browser:install");
}
if (process.argv.includes("--database")) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    const result = await pool.query("SELECT current_database() AS database, current_user AS role, version()");
    report("Database", true, `${result.rows[0].database} / ${result.rows[0].role}`);
    const permissions = await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    report("Database role", !permissions.rows[0].rolsuper, "application role must not be superuser");
  } catch { report("Database", false, "connection failed; run pnpm db:start"); }
  finally { await pool.end(); }
}
process.exitCode = failed ? 1 : 0;
