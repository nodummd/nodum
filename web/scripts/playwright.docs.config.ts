import { defineConfig } from "@playwright/test";

/**
 * Captures the screenshots the documentation shows, from the real app.
 * Run: `npm run docs:shots` (needs the dev stack: API on :8000 with
 * AI_ALLOW_PRIVATE_BASE_URLS=true, web on BASE_URL). Not part of the e2e
 * suite — it writes into public/docs.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /docs-screenshots\.spec\.ts/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    trace: "off",
  },
});
