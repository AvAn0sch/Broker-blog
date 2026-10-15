import { setTimeout } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

export type Transaction = { client: PoolClient; db: NodePgDatabase };

/** Callbacks may be retried: keep every effect inside this database transaction. */
export async function withTransaction<T>(pool: Pool, work: (tx: Transaction) => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await work({ client, db: drizzle(client) });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      const code = (error as { code?: string }).code;
      if (attempt >= retries || !["40001", "40P01"].includes(code ?? "")) throw error;
    } finally { client.release(broken); }
    await setTimeout(10 * (attempt + 1));
  }
}
