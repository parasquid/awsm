import { describe, expect, it } from "vitest";
import type { SynchronizationJobV1 } from "../../src/drivers/indexeddb/schema";
import { InterruptedStaleRecoveryReconciler } from "../../src/runtime/synchronization/recovery-reconciliation";

function job(
  stage: SynchronizationJobV1["stage"],
  state: SynchronizationJobV1["state"] = "Running",
): SynchronizationJobV1 {
  return {
    version: 1,
    jobId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    vaultId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    generationNumber: 1,
    state,
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
    recoveryForkVaultId: crypto.randomUUID(),
  };
}

describe("interrupted stale recovery reconciliation", () => {
  for (const stage of [
    "PrepareRecoveryFork",
    "PrepareServerReplacement",
    "ActivateRecovery",
  ] as const) {
    it(`returns ${stage} to Conflict and cleans the uncommitted fork`, async () => {
      const initial = job(stage);
      const saved: SynchronizationJobV1[] = [];
      const reconciled: string[] = [];
      const result = await new InterruptedStaleRecoveryReconciler(
        {
          latestSynchronizationJob: async () => initial,
          saveSynchronizationJob: async (value) => {
            saved.push(value);
          },
        },
        {
          reconcile: async (vaultId) => {
            reconciled.push(vaultId);
          },
        },
      ).execute("2026-07-20T01:00:00.000Z");

      expect(result).toBe(true);
      expect(reconciled).toEqual([initial.recoveryForkVaultId]);
      expect(saved).toEqual([expect.objectContaining({ state: "Conflict", stage: "Checkpoint" })]);
      expect(saved[0]).not.toHaveProperty("recoveryForkVaultId");
    });
  }

  it("does not roll back a committed recovery", async () => {
    const initial = job("Checkpoint", "Succeeded");
    let saved = false;
    const result = await new InterruptedStaleRecoveryReconciler(
      {
        latestSynchronizationJob: async () => initial,
        saveSynchronizationJob: async () => {
          saved = true;
        },
      },
      { reconcile: async () => undefined },
    ).execute();

    expect(result).toBe(false);
    expect(saved).toBe(false);
  });
});
