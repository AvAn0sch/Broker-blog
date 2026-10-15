import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { createPool } from "../db/client";
import { migrateDatabase } from "../db/migrate";

const runRoot = () => path.resolve(".local/test-runs");
function identity(url: string) { const parsed = new URL(url); return createHash("sha256").update(`${parsed.host}${parsed.pathname}:${parsed.username}`).digest("hex"); }
function requireTestDatabase(url: string) {
  if (process.env.APP_ENV !== "test" || !new URL(url).pathname.endsWith("_test")) throw new Error("Test resources require APP_ENV=test and a dedicated _test database.");
}
export type TestRun = { id: string; schema: string; directory: string; media: string; marker: string; databaseIdentity: string };

export async function createTestRun(connectionString: string): Promise<TestRun> {
  requireTestDatabase(connectionString);
  const id = randomUUID().replaceAll("-", "");
  const directory = path.join(runRoot(), id);
  const run = { id, schema: `bbtest_${id}`, directory, media: path.join(directory, "media"), marker: randomBytes(32).toString("hex"), databaseIdentity: identity(connectionString) };
  await mkdir(run.media, { recursive: true });
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(run), { flag: "wx", mode: 0o600 });
  const pool = createPool(connectionString, run.schema);
  try {
    await pool.query(`CREATE SCHEMA "${run.schema}"`);
    await pool.query("CREATE TABLE _test_run (id text PRIMARY KEY, marker text NOT NULL)");
    await pool.query("INSERT INTO _test_run VALUES ($1,$2)", [run.id, run.marker]);
    await migrateDatabase(pool, run.schema);
  } catch (error) {
    try { await cleanupTestRun(connectionString, run); } catch { console.error(JSON.stringify({ runId: id, code: "TEST_SETUP_CLEANUP_FAILED" })); }
    throw error;
  } finally { await pool.end(); }
  return run;
}

export async function cleanupTestRun(connectionString: string, run: TestRun) {
  requireTestDatabase(connectionString);
  if (!/^[a-f0-9]{32}$/.test(run.id) || run.schema !== `bbtest_${run.id}` || run.databaseIdentity !== identity(connectionString)) throw new Error("Test run identity mismatch; refusing cleanup.");
  const expected = path.join(runRoot(), run.id);
  if (path.resolve(run.directory) !== expected || path.resolve(run.media) !== path.join(expected, "media")) throw new Error("Test cleanup path mismatch.");
  const rootPath = await realpath(runRoot());
  const directory = await realpath(expected);
  if (path.relative(rootPath, directory) !== run.id) throw new Error("Test directory escaped its root.");
  const manifest: TestRun = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.id !== run.id || manifest.marker !== run.marker) throw new Error("Test filesystem marker mismatch.");
  const mediaPath = await realpath(run.media).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (mediaPath && mediaPath !== path.join(directory, "media")) throw new Error("Test media directory escaped its run.");
  const pool = createPool(connectionString, run.schema);
  try {
    const namespace = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [run.schema]);
    if (namespace.rowCount) {
      const record = await pool.query("SELECT marker FROM _test_run WHERE id=$1", [run.id]);
      if (record.rows[0]?.marker !== run.marker) throw new Error("Test database marker mismatch.");
      await pool.query(`DROP SCHEMA "${run.schema}" CASCADE`);
    }
  } finally { await pool.end(); }
  // Only this run's media is disposable; manifests and reports remain available.
  if (mediaPath) await rm(mediaPath, { recursive: true });
}
