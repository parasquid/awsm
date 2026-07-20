import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { actionTimeout: 60_000, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node tests/e2e/server.mjs",
      port: 4174,
      reuseExistingServer: false,
    },
    {
      command: "../coordination-server/script/run-browser-proof.sh",
      url: "http://127.0.0.1:3300/ready",
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
