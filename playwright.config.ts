import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test.local", quiet: true });
const external = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = external ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "api", testMatch: "api/**/*.spec.ts" },
    { name: "desktop", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: external ? undefined : {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
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
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
