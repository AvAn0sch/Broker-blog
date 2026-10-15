import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runNode, root } from "./lib.mjs";

const folder = path.join(root, "drizzle");
const before = new Set(await readdir(folder).catch(() => []));
await runNode("node_modules/drizzle-kit/bin.cjs", ["generate", ...process.argv.slice(2)]);
for (const file of await readdir(folder)) {
  if (before.has(file) || !file.endsWith(".sql")) continue;
  const target = path.join(folder, file);
  const sql = await readFile(target, "utf8");
  // pgTable uses search_path at runtime. Keep checked-in foreign keys portable too.
  await writeFile(target, sql.replaceAll('REFERENCES "public".', "REFERENCES "));
}
