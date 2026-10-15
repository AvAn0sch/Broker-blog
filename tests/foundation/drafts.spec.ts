import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createPool } from "../../src/infrastructure/db/client";
import { contentService } from "../../src/modules/content/service";
import { mediaService } from "../../src/modules/media/service";
import { pngBytes } from "../fixtures/images";

test("B2 media in a first saved draft survives orphan cleanup after the grace period", async () => {
  const pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  const actorId = randomUUID();
  // Own root: advancing cleanup time must not touch another test's unreferenced uploads.
  const root = path.join(process.env.MEDIA_ROOT!, `draft-retention-${actorId}`);
  await mkdir(root, { recursive: true });
  const secret = process.env.SESSION_SECRET!;
  const media = mediaService({ pool, root, secret });
  try {
    await pool.query("INSERT INTO users (id,email_normalized,password_hash,nickname) VALUES ($1,$2,'unusable:retention-fixture','图片作者')", [actorId, `${actorId}@example.test`]);
    const uploaded = await media.upload({ actorId, idempotencyKey: randomUUID(), bytes: pngBytes(6, 4) });
    const content = contentService({ pool, secret, media });
    await content.createDraft({ actorId, idempotencyKey: randomUUID(), markdown: `![图](/api/v1/media/${uploaded.media.id})` });
    const cleanup = mediaService({ pool, root, secret, clock: { now: () => new Date(Date.now() + 25 * 60 * 60 * 1000) } });
    expect((await cleanup.cleanupOrphans()).removed).toBe(0);
    const read = await media.read({ mediaId: uploaded.media.id, viewer: { id: actorId, role: "user", status: "normal" } });
    expect(read.bytes.equals(pngBytes(6, 4))).toBe(true);
  } finally { await pool.end(); }
});
