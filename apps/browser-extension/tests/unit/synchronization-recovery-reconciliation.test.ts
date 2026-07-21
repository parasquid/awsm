import { describe, expect, it } from "vitest";
import type { SynchronizationJobV1 } from "../../src/drivers/indexeddb/schema";
import { InterruptedStaleDiscardReconciler } from "../../src/runtime/synchronization/recovery-reconciliation";

function job(stage: SynchronizationJobV1["stage"]): SynchronizationJobV1 {
  return {
    version: 1,
    jobId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    vaultId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    generationNumber: 1,
    state: "Running",
    stage,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    snapshotCursor: 1,
    completedItems: 0,
    totalItems: 0,
    processedBytes: 0,
    totalBytes: 0,
    retryCount: 0,
    attachIdempotencyKey: crypto.randomUUID(),
    preparedArtifactObjectIds: [crypto.randomUUID(), crypto.randomUUID()],
  };
}

describe("interrupted stale discard reconciliation", () => {
  for (const stage of ["PrepareServerReplacement", "ActivateServerReplacement"] as const) {
    it(`returns ${stage} to Conflict and removes prepared replacement wrappers`, async () => {
      const initial = job(stage);
      const saved: SynchronizationJobV1[] = [];
      const removed: string[] = [];
      const result = await new InterruptedStaleDiscardReconciler(
        {
          latestSynchronizationJob: async () => initial,
          saveSynchronizationJob: async (value) => {
            saved.push(value);
          },
        },
        {
          remove: async (_vaultId, objectId) => {
            removed.push(objectId);
          },
        },
      ).execute("2026-07-20T01:00:00.000Z");

      expect(result).toBe(true);
      expect(removed.toSorted()).toEqual(initial.preparedArtifactObjectIds?.toSorted());
      expect(saved).toEqual([expect.objectContaining({ state: "Conflict", stage: "Checkpoint" })]);
      expect(saved[0]).not.toHaveProperty("preparedArtifactObjectIds");
    });
  }

  it("does not roll back a committed replacement", async () => {
    const initial = { ...job("Checkpoint"), state: "Succeeded" as const };
    let saved = false;
    const result = await new InterruptedStaleDiscardReconciler(
      {
        latestSynchronizationJob: async () => initial,
        saveSynchronizationJob: async () => {
          saved = true;
        },
      },
      { remove: async () => undefined },
    ).execute();

    expect(result).toBe(false);
    expect(saved).toBe(false);
  });
});
