import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite — runs against a live stack:
 *   API on :8000 (uv run uvicorn app.main:app) + web dev/prod server.
 * BASE_URL overrides the target (default local dev server on :3100).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // scenarios share a fresh-user flow; keep ordered within files
  forbidOnly: Boolean(process.env.CI),
  // One retry everywhere: the suite drives a live dev server where first-hit
  // route compiles can push a single navigation past its timeout.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? "github" : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
