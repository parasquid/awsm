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

  it("routes only canonical Workspace-scoped Import requests", () => {
    expect(isAppRequest({ type: "BeginVaultImport", sourceByteLength: 42 })).toBe(true);
    expect(isAppRequest({ type: "BeginVaultImport", sourceByteLength: -1 })).toBe(false);
    expect(
      isAppRequest({ type: "ReportVaultImportProgress", jobId: "job", acquiredBytes: 21 }),
    ).toBe(true);
    expect(isAppRequest({ type: "CompleteVaultImportStaging", jobId: "job" })).toBe(true);
    expect(isAppRequest({ type: "ImportVault", jobId: "job", passphrase: "secret" })).toBe(true);
    expect(isAppRequest({ type: "ImportVault", jobId: "job" })).toBe(false);
    expect(isAppRequest({ type: "CancelVaultImport", jobId: "job" })).toBe(true);
    expect(
      isAppRequest({
        type: "CancelVaultImport",
        jobId: "job",
        expectedVaultId: "not-applicable",
      }),
    ).toBe(false);
  });

  it("accepts only canonical Vault-scoped Artifact session requests", () => {
    expect(
      isAppRequest({
        type: "OpenArtifact",
        expectedVaultId: "vault",
        bundleId: "bundle",
        role: "CONTENT_STRUCTURED",
      }),
    ).toBe(true);
    expect(
      isAppRequest({
        type: "OpenArtifact",
        expectedVaultId: "vault",
        bundleId: "bundle",
        role: "ARBITRARY_FILE",
      }),
    ).toBe(false);
    expect(
      isAppRequest({ type: "ReadArtifactChunk", expectedVaultId: "vault", sessionId: "session" }),
    ).toBe(true);
    expect(isAppRequest({ type: "ReadArtifactChunk", expectedVaultId: "vault" })).toBe(false);
  });
});
