import { describe, expect, it } from "vitest";
import { isAppRequest } from "../../src/app/protocol";

describe("application request routing", () => {
  it("does not claim offscreen operations or application-state notifications", () => {
    expect(isAppRequest({ type: "awsm:stitch-screenshot" })).toBe(false);
    expect(isAppRequest({ type: "AppStateChanged" })).toBe(false);
    expect(isAppRequest({ type: "GetState" })).toBe(true);
  });

  it("rejects superseded local passphrase requests", () => {
    expect(isAppRequest({ type: "UnlockPassphrase", passphrase: "not supported" })).toBe(false);
    expect(
      isAppRequest({
        type: "CreateVault",
        name: "Amber Archive",
        passphrase: "not supported",
      }),
    ).toBe(false);
  });

  it("routes scoped Export and cancellation requests", () => {
    expect(
      isAppRequest({ type: "ExportVault", expectedVaultId: "vault", passphrase: "secret" }),
    ).toBe(true);
    expect(isAppRequest({ type: "ExportVault", expectedVaultId: "vault" })).toBe(false);
    expect(
      isAppRequest({ type: "CancelVaultExport", expectedVaultId: "vault", jobId: "job" }),
    ).toBe(true);
  });
});
