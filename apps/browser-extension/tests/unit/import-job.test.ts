import { describe, expect, it } from "vitest";
import { decodeImportJob } from "../../src/drivers/indexeddb/decode";

const jobId = "00000000-0000-4000-8000-000000000701";
const vaultId = "00000000-0000-4000-8000-000000000702";
const timestamp = "2026-07-19T00:00:00.000Z";

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    jobId,
    state: "Created",
    stage: "Acquire",
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceByteLength: 100,
    acquiredBytes: 0,
    completedEntries: 0,
    totalEntries: 0,
    processedBytes: 0,
    totalBytes: 0,
    cancellationRequested: false,
    ...overrides,
  };
}

describe("persisted Import Job", () => {
  it("decodes the canonical acquisition and authenticated execution states", () => {
    expect(decodeImportJob(job())).toEqual(job());
    expect(
      decodeImportJob(
        job({
          state: "Running",
          stage: "Validate",
          acquiredBytes: 100,
          destinationVaultId: vaultId,
        }),
      ),
    ).toMatchObject({
      state: "Running",
      stage: "Validate",
      destinationVaultId: vaultId,
    });
  });

  it("rejects impossible progress, state, stage, identity, and secret fields", () => {
    expect(() => decodeImportJob(job({ acquiredBytes: 101 }))).toThrow();
    expect(() => decodeImportJob(job({ state: "Paused" }))).toThrow();
    expect(() => decodeImportJob(job({ stage: "Preview" }))).toThrow();
    expect(() => decodeImportJob(job({ jobId: "job" }))).toThrow();
    expect(() => decodeImportJob(job({ passphrase: "must not persist" }))).toThrow();
    expect(() => decodeImportJob(job({ state: "Running", stage: "Validate" }))).toThrow();
    expect(() =>
      decodeImportJob(job({ state: "Created", stage: "Acquire", destinationVaultId: vaultId })),
    ).toThrow();
  });

  it("allows only terminal Jobs to persist safe terminal errors", () => {
    expect(
      decodeImportJob(
        job({
          state: "Failed",
          stage: "Validate",
          acquiredBytes: 100,
          destinationVaultId: vaultId,
          errorId: "IMPORT_PACKAGE_INVALID",
        }),
      ),
    ).toMatchObject({ state: "Failed", errorId: "IMPORT_PACKAGE_INVALID" });
    expect(() => decodeImportJob(job({ errorId: "IMPORT_PACKAGE_INVALID" }))).toThrow();
  });
});
