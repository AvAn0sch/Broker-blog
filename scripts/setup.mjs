import { mkdir, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { root } from "./lib.mjs";

const secret = () => randomBytes(32).toString("hex");
const appPassword = secret();
const testPassword = secret();
const adminPassword = secret();

async function createOnce(file, text) {
  try {
    await writeFile(path.join(root, file), text, { flag: "wx", mode: 0o600 });
    console.log(`Created ${file}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`Kept existing ${file}`);
  }
}

for (const directory of [".local", ".local/media/development", ".local/media/test", ".local/postgres", ".local/playwright", ".tools"]) {
  await mkdir(path.join(root, directory), { recursive: true });
}
for (const [file, mode, role, database, port, password] of [
  [".env.local", "development", "broker_app", "broker_blog", 3000, appPassword],
  [".env.test.local", "test", "broker_test", "broker_blog_test", 3100, testPassword],
]) {
  await createOnce(file, `APP_ENV=${mode}\nAPP_ORIGIN=http://127.0.0.1:${port}\nDATABASE_URL=postgresql://${role}:${password}@127.0.0.1:55432/${database}\nMEDIA_ROOT=.local/media/${mode}\nSESSION_SECRET=${secret()}\nCAPTCHA_SECRET=${secret()}\nPG_BIN=.tools/postgresql/pgsql/bin\nPLAYWRIGHT_BROWSERS_PATH=.local/playwright\nNEXT_TELEMETRY_DISABLED=1\n`);
}
await createOnce(".local/postgres/admin-password", `${adminPassword}\n`);
await createOnce(".env.compose.local", `POSTGRES_PASSWORD=${secret()}\nBROKER_APP_PASSWORD=${secret()}\nSESSION_SECRET=${secret()}\nCAPTCHA_SECRET=${secret()}\n`);
await access(path.join(root, ".env.local"));
console.log("Local configuration is ready. Passwords and data are ignored by Git.");
