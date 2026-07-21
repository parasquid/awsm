import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "AWSM",
    short_name: "AWSM",
    description: "Archive what should matter, privately and locally.",
    minimum_chrome_version: "116",
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    action: {
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
      },
    },
    permissions: [
      "activeTab",
      "scripting",
      "pageCapture",
      "offscreen",
      "unlimitedStorage",
      "downloads",
      "alarms",
    ],
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
