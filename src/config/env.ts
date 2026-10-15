import path from "node:path";
import { z } from "zod";

const environment = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), "PostgreSQL URL required"),
  MEDIA_ROOT: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  CAPTCHA_SECRET: z.string().min(32),
  DATABASE_SCHEMA: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).default("public"),
  TEST_RUN_ID: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  TEST_CONTROLS: z.enum(["true", "false"]).default("false"),
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
  if (result.data.TEST_RUN_ID && (result.data.APP_ENV !== "test" || result.data.DATABASE_SCHEMA !== `bbtest_${result.data.TEST_RUN_ID}`)) {
    throw new Error("Test run configuration must use its own test schema.");
  }
  if (result.data.TEST_CONTROLS === "true" && (result.data.APP_ENV !== "test" || !result.data.TEST_RUN_ID)) {
    throw new Error("Test controls require an isolated test run.");
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
