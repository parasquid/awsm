import { describe, expect, it } from "vitest";
import type { SynchronizationJobV1 } from "../../src/drivers/indexeddb/schema";
import { StaleReplicaRecoveryService } from "../../src/runtime/synchronization/recovery";

describe("stale Replica recovery", () => {
  it("returns an interrupted preparation to retryable Conflict and removes fork Artifacts", async () => {
    const vaultId = "01900000-0000-7000-8000-000000000701";
    const staleGenerationId = "01900000-0000-7000-8000-000000000702";
    const remoteGenerationId = "01900000-0000-7000-8000-000000000703";
    const forkVaultId = "01900000-0000-7000-8000-000000000704";
    const initial: SynchronizationJobV1 = {
      version: 1,
      jobId: "01900000-0000-7000-8000-000000000705",
      accountId: "01900000-0000-7000-8000-000000000706",
      vaultId,
      generationId: remoteGenerationId,
      generationNumber: 2,
      state: "Conflict",
      stage: "Checkpoint",
      completedItems: 0,
      totalItems: 0,
      processedBytes: 0,
      totalBytes: 0,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
      snapshotCursor: 8,
      retryCount: 0,
      attachIdempotencyKey: "01900000-0000-7000-8000-000000000707",
    };
    const saved: SynchronizationJobV1[] = [];
    const reconciled: string[] = [];
    const failure = Object.assign(new Error("offline"), { id: "SYNCHRONIZATION_INTERRUPTED" });
    const service = new StaleReplicaRecoveryService(
      {
        latestSynchronizationJob: async () => initial,
        loadAccountVault: async () => ({
          version: 1,
          accountId: initial.accountId,
          vaultId,
          accountKeyId: "01900000-0000-7000-8000-000000000708",
          accountSlot: {} as never,
          remoteGenerationId,
          remoteGenerationNumber: 2,
          deliveryCursor: 8,
        }),
        saveSynchronizationJob: async (job) => {
          saved.push(job);
        },
      },
      {} as never,
      {
        listStoredEvents: async () => [],
        listStoredObjects: async () => [],
        getVaultGeneration: async () => ({}) as never,
      },
      {
        metadata: { vaultId },
        head: { generationId: staleGenerationId },
      } as never,
      {} as CryptoKey,
      {
        prepare: async (didCreateFork: (created: string) => Promise<void>) => {
          await didCreateFork(forkVaultId);
          return { records: { metadata: { vaultId: forkVaultId } } } as never;
        },
      } as never,
      {
        prepare: async () => {
          throw failure;
        },
      },
      {
        reconcile: async (targetVaultId: string) => {
          reconciled.push(targetVaultId);
        },
      } as never,
    );

    await expect(service.execute("2026-07-19T01:00:00.000Z")).rejects.toBe(failure);

    expect(saved.at(-1)).toMatchObject({
      state: "Conflict",
      stage: "Checkpoint",
    });
    expect(saved.at(-1)).not.toHaveProperty("recoveryForkVaultId");
    expect(reconciled).toEqual([forkVaultId]);
  });
});
