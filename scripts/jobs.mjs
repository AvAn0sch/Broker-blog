import { getEnvironment } from "../src/config/env.ts";
import { getPool } from "../src/infrastructure/db/client.ts";
import { withTransaction } from "../src/infrastructure/db/transaction.ts";
import { enqueueEvent, retryFailedJob } from "../src/modules/jobs/service.ts";

const pool = getPool();
try {
  const [action, jobId] = process.argv.slice(2);
  if (action === "status") console.log(JSON.stringify((await pool.query("SELECT id,event_id,handler,status,attempts,available_at,lease_until,last_error_code FROM jobs ORDER BY created_at DESC LIMIT 50")).rows, null, 2));
  else if (action === "retry") { await retryFailedJob(pool, jobId); console.log("Failed job queued for retry."); }
  else if (action === "probe") {
    if (getEnvironment().APP_ENV === "production") throw new Error("Environment probes are disabled in production.");
    console.log(JSON.stringify({ eventId: await withTransaction(pool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: {}, handlers: ["system.probe"] })) }));
  } else throw new Error("Use status, retry <job UUID>, or probe.");
} finally { await pool.end(); }
