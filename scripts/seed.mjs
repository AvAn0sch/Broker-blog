import { getEnvironment } from "../src/config/env.ts";
import { getPool } from "../src/infrastructure/db/client.ts";
import { withTransaction } from "../src/infrastructure/db/transaction.ts";

if (getEnvironment().APP_ENV === "production") throw new Error("Synthetic initialization is disabled in production.");
const pool = getPool();
try {
  await withTransaction(pool, async ({ client }) => {
    for (const [slug, name] of [["frontend", "前端开发"], ["react", "React"], ["typescript", "TypeScript"], ["postgresql", "PostgreSQL"], ["database", "数据库"], ["docker", "Docker"], ["engineering", "工程实践"], ["backend", "后端开发"]]) {
      await client.query("INSERT INTO tags (slug,name) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING", [slug, name]);
    }
  });
  console.log("Preset tags initialized; existing data was preserved. Use the restricted account scripts for synthetic accounts.");
} finally { await pool.end(); }
