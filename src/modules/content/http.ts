import { getEnvironment } from "../../config/env";
import { getPool } from "../../infrastructure/db/client";
import { media } from "../media/http";
import { contentService } from "./service";

export function content() {
  const env = getEnvironment();
  return contentService({ pool: getPool(), secret: env.SESSION_SECRET, media: media() });
}
