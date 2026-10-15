import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../../contracts/errors";
import { systemClock, type Clock } from "../../infrastructure/clock";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";

export const jobSettings = { leaseMs: 60_000, batchSize: 20, pollMs: 1000, retryMs: [5000, 30_000, 120_000, 600_000, 1_800_000] } as const;
const eventSchema = z.object({ type: z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/), payload: z.record(z.string().regex(/^[a-z][a-zA-Z]*Id$/), z.uuid()), handlers: z.array(z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/)).min(1).max(10) });
export type ClaimedJob = { id: string; event_id: string; handler: string; attempts: number; max_attempts: number; lease_token: string; lease_until: Date; type: string; payload: Record<string, string> };
export type JobHandler = (tx: Transaction, job: ClaimedJob) => Promise<void>;

export async function enqueueEvent(tx: Transaction, input: z.infer<typeof eventSchema>, clock: Clock = systemClock) {
  const event = eventSchema.parse(input);
  const eventId = randomUUID();
  const now = clock.now();
  await tx.client.query("INSERT INTO domain_events (id,type,payload,created_at) VALUES ($1,$2,$3::jsonb,$4)", [eventId, event.type, JSON.stringify(event.payload), now]);
  for (const handler of new Set(event.handlers)) {
    await tx.client.query("INSERT INTO jobs (event_id,handler,available_at,created_at) VALUES ($1,$2,$3,$3)", [eventId, handler, now]);
  }
  return eventId;
}

export async function claimJobs(pool: Pool, clock: Clock = systemClock, batchSize: number = jobSettings.batchSize): Promise<ClaimedJob[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Invalid claim batch size");
  return withTransaction(pool, async ({ client }) => {
    const now = clock.now();
    await client.query("UPDATE jobs SET status='failed', lease_token=NULL, lease_until=NULL, last_error_code='LEASE_ATTEMPTS_EXHAUSTED' WHERE status='running' AND lease_until <= $1 AND attempts >= max_attempts", [now]);
    const result = await client.query<ClaimedJob>(`WITH candidates AS (
      SELECT id FROM jobs WHERE attempts < max_attempts AND
      ((status IN ('pending','retry') AND available_at <= $1) OR (status='running' AND lease_until <= $1))
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ), claimed AS (
      UPDATE jobs j SET status='running', attempts=j.attempts+1, lease_token=gen_random_uuid(), lease_until=$3
      FROM candidates c WHERE j.id=c.id RETURNING j.*
    ) SELECT claimed.*, e.type,e.payload FROM claimed JOIN domain_events e ON e.id=claimed.event_id`, [now, batchSize, new Date(now.getTime() + jobSettings.leaseMs)]);
    return result.rows;
  });
}

export async function applyJobEffect(pool: Pool, job: ClaimedJob, handler: JobHandler, clock: Clock = systemClock) {
  return withTransaction(pool, async (tx) => {
    const locked = await tx.client.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until > $3 FOR UPDATE", [job.id, job.lease_token, clock.now()]);
    if (!locked.rowCount) return false;
    const receipt = await tx.client.query("SELECT 1 FROM job_receipts WHERE job_id=$1", [job.id]);
    if (!receipt.rowCount) {
      await handler(tx, job);
      await tx.client.query("INSERT INTO job_receipts (job_id,completed_at) VALUES ($1,$2)", [job.id, clock.now()]);
    }
    return true;
  });
}

export async function renewLease(pool: Pool, job: ClaimedJob, clock: Clock = systemClock) {
  const now = clock.now();
  const result = await pool.query("UPDATE jobs SET lease_until=$4 WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until > $3 RETURNING id", [job.id, job.lease_token, now, new Date(now.getTime() + jobSettings.leaseMs)]);
  return result.rowCount === 1;
}

export async function completeJob(pool: Pool, job: ClaimedJob, clock: Clock = systemClock) {
  const result = await pool.query("UPDATE jobs SET status='completed',completed_at=$3,lease_token=NULL,lease_until=NULL,last_error_code=NULL WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until > $3 AND EXISTS (SELECT 1 FROM job_receipts WHERE job_id=$1) RETURNING id", [job.id, job.lease_token, clock.now()]);
  return result.rowCount === 1;
}

export async function failJob(pool: Pool, job: ClaimedJob, code = "TASK_EXECUTION_FAILED", clock: Clock = systemClock) {
  const safeCode = /^[A-Z_]{1,64}$/.test(code) ? code : "TASK_EXECUTION_FAILED";
  const terminal = job.attempts >= job.max_attempts || safeCode === "UNKNOWN_HANDLER";
  const delay = jobSettings.retryMs[Math.min(Math.max(job.attempts - 1, 0), jobSettings.retryMs.length - 1)];
  const now = clock.now();
  const result = await pool.query("UPDATE jobs SET status=$3,available_at=$4,lease_token=NULL,lease_until=NULL,last_error_code=$5 WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until > $6 RETURNING id", [job.id, job.lease_token, terminal ? "failed" : "retry", new Date(now.getTime() + delay), safeCode, now]);
  return result.rowCount === 1;
}

export async function retryFailedJob(pool: Pool, jobId: string, clock: Clock = systemClock) {
  z.uuid().parse(jobId);
  const result = await pool.query("UPDATE jobs SET status='retry',attempts=0,available_at=$2,last_error_code=NULL WHERE id=$1 AND status='failed' RETURNING id", [jobId, clock.now()]);
  if (!result.rowCount) throw new AppError("JOB_STATE_CONFLICT", 409, "任务不存在或不处于失败状态。");
}

export const coreHandlers: Record<string, JobHandler> = { "system.probe": async (tx) => { await tx.client.query("SELECT 1"); } };
