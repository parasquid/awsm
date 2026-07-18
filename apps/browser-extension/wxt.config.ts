import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "AWSM",
    short_name: "AWSM",
    description: "Archive what should matter, privately and locally.",
    minimum_chrome_version: "116",
    permissions: [
      "activeTab",
      "scripting",
      "pageCapture",
      "offscreen",
      "unlimitedStorage",
      "downloads",
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
