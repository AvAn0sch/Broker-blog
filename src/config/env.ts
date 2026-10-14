import path from "node:path";
import { z } from "zod";

const environment = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), "PostgreSQL URL required"),
  MEDIA_ROOT: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  CAPTCHA_SECRET: z.string().min(32),
});

export function parseEnvironment(input: Record<string, string | undefined>) {
  const result = environment.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment fields: ${fields.join(", ")}`);
  }
  if ([result.data.SESSION_SECRET, result.data.CAPTCHA_SECRET].some((value) => value.startsWith("REPLACE_"))) {
    throw new Error("Generate local secrets with pnpm env:setup.");
  }
  const mediaRoot = path.resolve(result.data.MEDIA_ROOT);
  const relative = path.relative(path.resolve("public"), mediaRoot);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("MEDIA_ROOT must be outside public.");
  }
  return { ...result.data, MEDIA_ROOT: mediaRoot };
}

export function getEnvironment() {
  return parseEnvironment(process.env);
}
