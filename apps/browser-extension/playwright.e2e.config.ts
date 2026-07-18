import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "node tests/e2e/server.mjs",
    port: 4174,
    reuseExistingServer: false,
  },
});
