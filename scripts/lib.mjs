import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "dotenv";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvironment(test = false) {
  config({ path: path.join(root, test ? ".env.test.local" : ".env.local"), quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("Run pnpm env:setup first.");
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}`)));
  });
}

export function runNode(file, args = []) {
  return run(process.execPath, [path.join(root, file), ...args]);
}
