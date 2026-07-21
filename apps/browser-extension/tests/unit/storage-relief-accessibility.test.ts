import { describe, expect, it } from "vitest";
import type { StorageReliefJobView } from "../../src/app/storage-relief-protocol";
import {
  storageReliefAnnouncement,
  storageReliefFocusTarget,
} from "../../src/ui/storage-relief-accessibility";

function job(overrides: Partial<StorageReliefJobView> = {}): StorageReliefJobView {
  return {
    jobId: "01900000-0000-7000-8000-000000000001",
    state: "Running",
    stage: "Synchronizing",
    candidateArtifacts: 4,
    candidateBytes: 4_000,
    verifiedArtifacts: 0,
    verifiedBytes: 0,
    freedArtifacts: 0,
    freedBytes: 0,
    skippedArtifacts: 0,
    skippedBytes: 0,
    cancellationRequested: false,
    ...overrides,
  };
}

describe("storage-relief accessibility transitions", () => {
  it("announces start, stage, progress, cancellation, and terminal outcomes once", () => {
    const started = job();
    expect(storageReliefAnnouncement(undefined, started)).toBe(
      "Storage cleanup started. Synchronizing.",
    );
    expect(storageReliefAnnouncement(started, job({ stage: "Checking server copies" }))).toBe(
      "Storage cleanup: Checking server copies.",
    );
    expect(storageReliefAnnouncement(started, job({ verifiedArtifacts: 2 }))).toBe(
      "Storage cleanup progress: 2 of 4 Artifacts checked; 0 freed.",
    );
    expect(storageReliefAnnouncement(started, job({ cancellationRequested: true }))).toBe(
      "Cancelling storage cleanup.",
    );
    expect(storageReliefAnnouncement(started, job({ state: "Cancelled" }))).toBe(
      "Storage cleanup cancelled.",
    );
    expect(storageReliefAnnouncement(started, started)).toBeUndefined();
  });

  it("reports successful and safe failed completion", () => {
    const running = job({ stage: "Freeing browser storage" });
    expect(storageReliefAnnouncement(running, job({ state: "Succeeded", freedArtifacts: 4 }))).toBe(
      "Storage cleanup completed. 4 Artifacts were freed.",
    );
    expect(
      storageReliefAnnouncement(
        running,
        job({ state: "Failed", errorId: "REMOTE_ARTIFACT_UNAVAILABLE" }),
      ),
    ).toBe(
      "Storage cleanup stopped safely. Nothing unverified was removed (REMOTE_ARTIFACT_UNAVAILABLE).",
    );
  });

  it("restores focus only after the same Job becomes terminal", () => {
    const running = job();
    expect(storageReliefFocusTarget(running, job({ state: "Cancelled" }))).toBe("action");
    expect(storageReliefFocusTarget(running, job({ state: "Succeeded" }))).toBe("heading");
    expect(
      storageReliefFocusTarget(running, job({ jobId: "01900000-0000-7000-8000-000000000099" })),
    ).toBeUndefined();
  });
});
