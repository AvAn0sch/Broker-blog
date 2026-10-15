import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { getEnvironment } from "../config/env";
import { getPool } from "../infrastructure/db/client";
import { applyJobEffect, claimJobs, completeJob, coreHandlers, failJob, jobSettings } from "../modules/jobs/service";

const env = getEnvironment();
const pool = getPool();
const once = process.argv.includes("--once");
const heartbeat = path.resolve(process.env.WORKER_HEARTBEAT ?? ".local/worker-heartbeat.json");
await mkdir(path.dirname(heartbeat), { recursive: true });
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });

console.log(JSON.stringify({ service: "worker", mode: "persistent-jobs", environment: env.APP_ENV, runId: env.TEST_RUN_ID }));
try {
  do {
    try {
      const jobs = await claimJobs(pool, undefined, 1);
      await writeFile(heartbeat, JSON.stringify({ status: "ready", updatedAt: new Date().toISOString() }));
      for (const job of jobs) {
        if (stopping) break;
        const handler = Object.hasOwn(coreHandlers, job.handler) ? coreHandlers[job.handler] : undefined;
        if (!handler) { await failJob(pool, job, "UNKNOWN_HANDLER"); continue; }
        try {
          // Database effects are bounded by the transaction timeout, below the lease duration.
          if (await applyJobEffect(pool, job, handler)) await completeJob(pool, job);
        } catch {
          await failJob(pool, job);
          console.error(JSON.stringify({ jobId: job.id, eventId: job.event_id, code: "TASK_EXECUTION_FAILED" }));
        }
      }
    } catch {
      await writeFile(heartbeat, JSON.stringify({ status: "not_ready", updatedAt: new Date().toISOString() }));
      console.error(JSON.stringify({ service: "worker", code: "WORKER_DATABASE_UNAVAILABLE" }));
      if (once) process.exitCode = 1;
    }
    if (!once && !stopping) await setTimeout(jobSettings.pollMs);
  } while (!once && !stopping);
} finally { await pool.end(); }
