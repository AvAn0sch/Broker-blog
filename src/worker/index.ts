import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { getEnvironment } from "../config/env";
import { getPool } from "../infrastructure/db/client";

const env = getEnvironment();
const heartbeat = path.resolve(process.env.WORKER_HEARTBEAT ?? ".local/worker-heartbeat.json");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });

console.log(JSON.stringify({ service: "worker", mode: "environment-probe", environment: env.APP_ENV }));
while (!stopping) {
  try {
    await getPool().query("SELECT 1");
    await writeFile(heartbeat, JSON.stringify({ status: "ready", updatedAt: new Date().toISOString() }));
  } catch {
    await writeFile(heartbeat, JSON.stringify({ status: "not_ready", updatedAt: new Date().toISOString() }));
    console.error(JSON.stringify({ service: "worker", code: "DATABASE_UNAVAILABLE" }));
  }
  await setTimeout(5000);
}
await getPool().end();
