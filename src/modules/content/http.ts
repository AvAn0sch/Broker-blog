import { getEnvironment } from "../../config/env";
import { getPool } from "../../infrastructure/db/client";
import { media } from "../media/http";
import { contentService } from "./service";
import { z } from "zod";
import { AppError } from "../../contracts/errors";

export function articleIdOf(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("ARTICLE_NOT_FOUND", 404, "文章不存在。");
  return id;
}

export function content() {
  const env = getEnvironment();
  return contentService({ pool: getPool(), secret: env.SESSION_SECRET, media: media() });
}
