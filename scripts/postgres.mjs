import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { config } from "dotenv";
import { loadEnvironment, root, run } from "./lib.mjs";

const action = process.argv[2];
loadEnvironment();
const data = path.join(root, ".local/postgres/data");
const adminPasswordFile = path.join(root, ".local/postgres/admin-password");
const bin = path.resolve(process.env.PG_BIN);
const exe = (name) => path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

async function exists(file) { try { await access(file); return true; } catch { return false; } }

if (action === "install") {
  if (process.platform !== "win32") throw new Error("On Linux install PostgreSQL 17.11 and set PG_BIN, or use Compose.");
  if (await exists(exe("postgres"))) {
    console.log(execFileSync(exe("postgres"), ["--version"], { encoding: "utf8", windowsHide: true }).trim());
    process.exit(0);
  }
  const file = "postgresql-17.11-5-windows-x64-binaries.zip";
  const url = `https://get.enterprisedb.com/postgresql/${file}`;
  // EDB maintainer checksum: https://github.com/EnterpriseDB/edb-installers/issues/731
  const checksum = "80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f";
  const download = path.join(root, ".tools", file);
  await mkdir(path.dirname(download), { recursive: true });
  if (!(await exists(download))) {
    console.log(`Downloading PostgreSQL 17.11 from EDB into .tools (${file})`);
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(download, { flags: "wx" }));
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(download)) hash.update(chunk);
  if (hash.digest("hex") !== checksum) throw new Error("PostgreSQL archive checksum mismatch; archive was not executed or extracted.");
  const destination = path.join(root, ".tools/postgresql");
  await mkdir(destination, { recursive: true });
  console.log("Checksum verified; extracting native PostgreSQL.");
  await run("tar.exe", ["-xf", download, "-C", destination]);
  console.log(execFileSync(exe("postgres"), ["--version"], { encoding: "utf8", windowsHide: true }).trim());
} else if (action === "start") {
  const parsed = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Native database control only supports a local database.");
  const port = parsed.port || "55432";
  const adminPassword = (await readFile(adminPasswordFile, "utf8")).trim();
  if (!(await exists(path.join(data, "PG_VERSION")))) {
    await run(exe("initdb"), ["-D", data, "-U", "postgres", "--pwfile", adminPasswordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    await writeFile(path.join(data, "broker.conf"), `listen_addresses = '127.0.0.1'\nport = ${port}\ntimezone = 'UTC'\n`, { flag: "wx" });
    const configFile = path.join(data, "postgresql.conf");
    await writeFile(configFile, `${await readFile(configFile, "utf8")}\ninclude = 'broker.conf'\n`);
  }
  let running = false;
  try { execFileSync(exe("pg_ctl"), ["status", "-D", data], { stdio: "ignore", windowsHide: true }); running = true; } catch {}
  if (!running) await run(exe("pg_ctl"), ["start", "-D", data, "-l", path.join(root, ".local/postgres/server.log"), "-w"]);
  const admin = new pg.Client({ host: "127.0.0.1", port: Number(port), user: "postgres", password: adminPassword, database: "postgres", connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    for (const file of [".env.local", ".env.test.local"]) {
      const values = config({ path: path.join(root, file), processEnv: {}, quiet: true }).parsed;
      if (!values?.DATABASE_URL) throw new Error(`Missing DATABASE_URL in ${file}`);
      const target = new URL(values.DATABASE_URL);
      if (target.hostname !== parsed.hostname || target.port !== parsed.port) throw new Error("Local development and test databases must use the same native cluster.");
      const role = decodeURIComponent(target.username);
      const password = decodeURIComponent(target.password);
      const database = target.pathname.slice(1);
      if (!/^broker_[a-z_]+$/.test(role) || !/^broker_[a-z_]+$/.test(database)) throw new Error("Refusing to manage a database outside the broker_ namespace.");
      const roles = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (!roles.rowCount) await admin.query(`CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoteLiteral(password)}`);
      const databases = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (!databases.rowCount) await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} OWNER ${quoteIdentifier(role)}`);
      console.log(`Ready: ${database} on 127.0.0.1:${port}`);
    }
  } finally { await admin.end(); }
} else if (action === "stop") {
  if (!(await exists(path.join(data, "PG_VERSION")))) throw new Error("No project database cluster was initialized.");
  await run(exe("pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w"]);
} else {
  throw new Error("Use install, start or stop.");
}
