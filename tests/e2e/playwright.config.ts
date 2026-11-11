// Playwright drives the built Electron app (no browser download). Everything it writes stays under .runtime/.
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "*.spec.ts",
  outputDir: resolve(root, ".runtime/e2e-results"),
  globalSetup: resolve(import.meta.dirname, "globalSetup.ts"),
  // One Electron window at a time: the tests use real pointer input and each needs the focused window.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["json", { outputFile: resolve(root, ".runtime/e2e-report.json") }]],
  use: { trace: "retain-on-failure" },
});
