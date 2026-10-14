import { expect, test } from "@playwright/test";
import pg from "pg";

test("ENV-01 liveness and database/media readiness", async ({ request }) => {
  expect((await request.get("/api/health/live")).status()).toBe(200);
  const response = await request.get("/api/health/ready");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ready", database: "ok", media: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("ENV-01 real PostgreSQL transaction rollback and restricted application role", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !new URL(connectionString).pathname.endsWith("_test")) throw new Error("A dedicated _test database is required.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const role = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(role.rows[0].rolsuper).toBe(false);
    await client.query("CREATE TEMPORARY TABLE environment_probe (id integer PRIMARY KEY)");
    await client.query("BEGIN");
    await client.query("INSERT INTO environment_probe VALUES (1)");
    await client.query("ROLLBACK");
    const result = await client.query("SELECT count(*)::integer AS count FROM environment_probe");
    expect(result.rows[0].count).toBe(0);
  } finally { await client.end(); }
});
