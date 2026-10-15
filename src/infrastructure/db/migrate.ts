import type { Pool } from "pg";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

export async function migrateDatabase(pool: Pool, schema = "public", folder = path.resolve("drizzle")) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid migration schema");
  const files = readMigrationFiles({ migrationsFolder: folder });
  for (const file of files) {
    if (file.sql.some((statement) => /"public"\s*\./.test(statement))) throw new Error("Migration must not escape its configured namespace.");
  }
  const client = await pool.connect();
  const lock = `broker:migrate:${schema}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lock]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const existing = await client.query("SELECT to_regclass($1) AS name", [`${schema}.__drizzle_migrations`]);
    if (existing.rows[0].name) {
      const applied = await client.query(`SELECT hash,created_at FROM "${schema}".__drizzle_migrations ORDER BY created_at,id`);
      if (applied.rows.length > files.length || applied.rows.some((row, i) => row.hash !== files[i]?.hash || Number(row.created_at) !== files[i]?.folderMillis)) throw new Error("Applied migration history differs from checked-in migrations.");
    }
    await migrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: schema });
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]); } finally { client.release(); }
  }
}
