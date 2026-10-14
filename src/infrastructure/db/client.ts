import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnvironment } from "../../config/env";

const databaseGlobal = globalThis as unknown as { brokerPool?: pg.Pool };

export function getPool() {
  databaseGlobal.brokerPool ??= new pg.Pool({
    connectionString: getEnvironment().DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000,
  });
  return databaseGlobal.brokerPool;
}

export function getDatabase() {
  return drizzle(getPool());
}
