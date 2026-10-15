import { getEnvironment } from "../src/config/env.ts";
import { getPool } from "../src/infrastructure/db/client.ts";
import { checksumOf, inspectImage, mediaStore } from "../src/infrastructure/storage/media-store.ts";
import { mediaService } from "../src/modules/media/service.ts";

const pool = getPool();
try {
  const [action, mediaId] = process.argv.slice(2);
  const env = getEnvironment();
  const media = mediaService({ pool, secret: env.SESSION_SECRET, root: env.MEDIA_ROOT });
  if (action === "recover") console.log(JSON.stringify(await media.recoverStaged()));
  else if (action === "cleanup") console.log(JSON.stringify(await media.cleanupOrphans()));
  else if (action === "verify") {
    // Reads the stored file in this process only: evidence that persistence outlives the writer.
    const row = (await pool.query("SELECT id,storage_key,mime,size,status,checksum FROM media WHERE id=$1", [mediaId])).rows[0];
    if (!row) throw new Error("Media not found.");
    const bytes = await mediaStore({ root: env.MEDIA_ROOT }).read(row.storage_key);
    const image = inspectImage(bytes);
    console.log(JSON.stringify({ id: row.id, status: row.status, databaseChecksum: row.checksum, databaseSize: row.size, fileChecksum: checksumOf(bytes), fileSize: bytes.length, fileMime: image?.mime ?? null }));
  } else throw new Error("Use recover, cleanup, or verify <media UUID>.");
} finally { await pool.end(); }
