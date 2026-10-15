import { getEnvironment } from "../../config/env";
import { getPool } from "../../infrastructure/db/client";
import { mediaPolicy } from "./policy";
import { mediaService } from "./service";

export function media() {
  const env = getEnvironment();
  return mediaService({ pool: getPool(), secret: env.SESSION_SECRET, root: env.MEDIA_ROOT });
}

export { mediaPolicy };
