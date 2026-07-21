import { describe, expect, it } from "vitest";

import { vaultExportFilename } from "../../src/runtime/export";

describe("Vault Export filename", () => {
  it("uses the neutral UTC creation date even when the timestamp has fractional seconds", () => {
    expect(vaultExportFilename("2026-07-21T05:12:34.567Z")).toBe("awsm-vault-2026-07-21.awsm");
  });

  it("rejects an invalid creation timestamp", () => {
    expect(() => vaultExportFilename("2026-99-99T05:12:34.567Z")).toThrow(
      "Invalid Export creation timestamp.",
    );
  });
});
