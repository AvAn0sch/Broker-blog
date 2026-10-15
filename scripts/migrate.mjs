import { getEnvironment } from "../src/config/env.ts";
import { getPool } from "../src/infrastructure/db/client.ts";
import { migrateDatabase } from "../src/infrastructure/db/migrate.ts";

const env = getEnvironment();
const pool = getPool();
try {
  await migrateDatabase(pool, env.DATABASE_SCHEMA);
  console.log("Versioned database migrations applied and history verified.");
} finally { await pool.end(); }
