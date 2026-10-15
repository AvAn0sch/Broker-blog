import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnvironment } from "../../config/env";

const databaseGlobal = globalThis as unknown as { brokerPools?: Map<string, pg.Pool> };

export function createPool(connectionString: string, schema = "public") {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema");
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10_000, options: `-c search_path=${schema} -c timezone=UTC`, application_name: `broker_blog_${schema}` });
  pool.on("error", () => console.error(JSON.stringify({ code: "DATABASE_POOL_ERROR" })));
  return pool;
}

export function getPool() {
  const env = getEnvironment();
  const key = `${env.DATABASE_URL}#${env.DATABASE_SCHEMA}`;
  databaseGlobal.brokerPools ??= new Map();
  if (!databaseGlobal.brokerPools.has(key)) databaseGlobal.brokerPools.set(key, createPool(env.DATABASE_URL, env.DATABASE_SCHEMA));
  return databaseGlobal.brokerPools.get(key)!;
}

export function getDatabase() {
  return drizzle(getPool());
}
