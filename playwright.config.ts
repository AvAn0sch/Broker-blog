import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.test.local", quiet: true });
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
const external = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = external ?? "http://127.0.0.1:3100";
const reportDir = process.env.TEST_REPORT_DIR ?? "test-results";
if (external) throw new Error("Business verification must start its own application in the isolated test run; external servers are not supported.");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(reportDir, "html") }], ["json", { outputFile: path.join(reportDir, "results.json") }]],
  outputDir: path.join(reportDir, "artifacts"),
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "api", testMatch: "api/**/*.spec.ts" },
    { name: "foundation", testMatch: "foundation/**/*.spec.ts", workers: 1 },
    { name: "auth", testMatch: "auth/**/*.spec.ts", workers: 1, use: { trace: "off", screenshot: "off" } },
    { name: "desktop", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: external ? undefined : {
    command: `node node_modules/next/dist/bin/next ${process.env.PLAYWRIGHT_SERVER_MODE === "production" ? "start" : "dev --webpack"} --hostname 127.0.0.1 --port 3100`,
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      APP_ENV: "test",
      APP_ORIGIN: baseURL,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      MEDIA_ROOT: process.env.MEDIA_ROOT ?? "",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      CAPTCHA_SECRET: process.env.CAPTCHA_SECRET ?? "",
      DATABASE_SCHEMA: process.env.DATABASE_SCHEMA ?? "public",
      TEST_RUN_ID: process.env.TEST_RUN_ID ?? "",
      TEST_CONTROLS: process.env.TEST_CONTROLS ?? "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
