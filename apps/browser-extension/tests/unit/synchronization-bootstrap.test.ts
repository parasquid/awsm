import { describe, expect, it } from "vitest";
import type { SynchronizationJobV1 } from "../../src/drivers/indexeddb/schema";
import type { AtomicRemoteBootstrap } from "../../src/drivers/indexeddb/workspace-repository";
import { createAccountVaultSlot } from "../../src/runtime/account/crypto";
import { bytesToBase64Url } from "../../src/runtime/account/wire";
import { RemoteBootstrapRunner } from "../../src/runtime/synchronization/bootstrap";
import { prepareVaultGeneration } from "../../src/runtime/vault/generation";
import { prepareVaultNameChange } from "../../src/runtime/vault/name-crypto";

const accountId = "01900000-0000-7000-8000-000000000201";
const accountKeyId = "01900000-0000-7000-8000-000000000202";
const vaultId = "01900000-0000-7000-8000-000000000203";
const generationId = "01900000-0000-7000-8000-000000000204";

describe("remote Replica bootstrap", () => {
  it("prepares a fresh device slot and atomically activates verified authority", async () => {
    const accountEncryptionKey = new Uint8Array(32).fill(5);
    const rawRootKey = new Uint8Array(32).fill(6);
    const rootKey = await crypto.subtle.importKey("raw", rawRootKey, "HKDF", false, ["deriveBits"]);
    const generation = await prepareVaultGeneration({
      rootKey,
      vaultId,
      deviceId: "01900000-0000-7000-8000-000000000205",
      generationId,
      generationNumber: 0,
      createdAt: "2026-07-19T12:00:00.000Z",
      reason: "Initial",
      retainedObjectIds: [],
      retainedEventIds: [],
    });
    const eventId = "01900000-0000-7000-8000-000000000206";
    const created = await prepareVaultNameChange({
      rootKey,
      eventType: "VaultCreated",
      vaultId,
      deviceId: "01900000-0000-7000-8000-000000000205",
      eventId,
      timestamp: "2026-07-19T12:00:00.000Z",
      name: "Downloaded Vault",
    });
    const slot = await createAccountVaultSlot({
      vaultId,
      accountKeyId,
      accountEncryptionKey,
      vaultRootKey: rawRootKey,
    });
    let job: SynchronizationJobV1 = {
      version: 1 as const,
      jobId: crypto.randomUUID(),
      accountId,
      vaultId,
      generationId,
      generationNumber: 0,
      state: "Running" as const,
      stage: "DownloadRecords" as const,
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z",
      snapshotCursor: 2,
      completedItems: 0,
      totalItems: 2,
      processedBytes: 0,
      totalBytes: 0,
      retryCount: 0,
      attachIdempotencyKey: crypto.randomUUID(),
    };
    let committed: AtomicRemoteBootstrap | undefined;
    const runner = new RemoteBootstrapRunner(
      {
        latestSynchronizationJob: async () => job,
        loadAccountVault: async () => ({
          version: 1,
          accountId,
          vaultId,
          accountKeyId,
          accountSlot: {
            ...slot,
            nonce: bytesToBase64Url(slot.nonce),
            ciphertext: bytesToBase64Url(slot.ciphertext),
          },
          remoteGenerationId: generationId,
          remoteGenerationNumber: 0,
          deliveryCursor: 2,
        }),
        loadAccountEncryptionKey: async () => Uint8Array.from(accountEncryptionKey),
        saveSynchronizationJob: async (next) => {
          job = next;
        },
      },
      {
        load: async () => ({
          metadata: { workspaceId: "01900000-0000-7000-8000-000000000207" },
          nameCacheKey: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
            "encrypt",
            "decrypt",
          ]),
        }),
        commitRemoteBootstrap: async (input) => {
          committed = input;
        },
      },
      {
        prepare: async () => {
          throw new Error("unexpected");
        },
        prepareEncrypted: async () => undefined,
        openEncrypted: async () => {
          throw new Error("unexpected");
        },
        openPlaintext: async () => {
          throw new Error("unexpected");
        },
        has: async () => false,
        verifyEncrypted: async () => false,
        remove: async () => undefined,
        reconcile: async () => undefined,
      },
      {
        prepare: async () => ({
          generation: generation.generation,
          head: { ...generation.head, appendedEventIds: [eventId] },
          events: [created.event],
          objects: [],
          preparedArtifactObjectIds: [],
        }),
      },
    );

    await expect(runner.run()).resolves.toBe(vaultId);
    expect(committed?.job).toMatchObject({ stage: "ActivateLocal", state: "Running" });
    expect(committed?.records).toMatchObject({
      metadata: { vaultId, manuallyLocked: false },
      head: { generationId, appendedEventIds: [eventId] },
    });
    expect(committed?.records.metadata.deviceId).not.toBe("01900000-0000-7000-8000-000000000205");
    expect(committed?.vaultNameProjection).toMatchObject({ vaultId, sourceEventId: eventId });
  });
});
