import { describe, expect, it } from "vitest";
import {
  decodeEncryptedEnvelopeBytes,
  decryptEnvelope,
  encodeEncryptedEnvelope,
  encryptEnvelope,
} from "../../src/crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../src/crypto/hkdf";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../src/domain/cbor";
import type { LibraryItemV1 } from "../../src/domain/contracts";
import type { StoredEventV1, StoredObjectV1, StoredVaultHeadV1 } from "../../src/drivers/indexeddb";
import type { LibraryService } from "../../src/runtime/library/service";
import { type VacuumRepository, VaultVacuumService } from "../../src/runtime/library/vacuum";
import { prepareVaultGeneration } from "../../src/runtime/vault/generation";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const vaultId = id(1);
const deviceId = id(2);
const initialHead: StoredVaultHeadV1 = {
  version: 1,
  vaultId,
  generationId: id(3),
  generationNumber: 0,
  appendedObjectIds: [],
  appendedEventIds: [],
};

function headWith(
  appendedObjectIds: readonly string[],
  appendedEventIds: readonly string[],
): StoredVaultHeadV1 {
  return {
    ...initialHead,
    appendedObjectIds: [...appendedObjectIds].toSorted(),
    appendedEventIds: [...appendedEventIds].toSorted(),
  };
}

async function rootKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(32).fill(5), "HKDF", false, ["deriveBits"]);
}

async function initialGeneration(key: CryptoKey) {
  return (
    await prepareVaultGeneration({
      rootKey: key,
      vaultId,
      deviceId,
      generationId: initialHead.generationId,
      generationNumber: 0,
      createdAt: "2026-07-17T00:00:00.000Z",
      reason: "Initial",
      retainedObjectIds: [],
      retainedEventIds: [],
    })
  ).generation;
}

async function storedEvent(
  key: CryptoKey,
  eventId: string,
  objectId: string,
  payload: Record<string, unknown>,
): Promise<StoredEventV1> {
  const eventKey = await deriveContextKeyFromCryptoKey(key, {
    vaultId,
    domain: "vault:event:v1",
    contextId: eventId,
    keyVersion: 1,
  });
  return {
    version: 1,
    eventId,
    objectId,
    orderingTimestamp: "2026-07-17T00:00:00.000Z",
    envelopeBytes: encodeEncryptedEnvelope(
      await encryptEnvelope({
        objectType: "Event",
        objectId: eventId,
        plaintext: encodeCanonicalCbor(payload),
        key: eventKey,
      }),
    ),
  };
}

async function decryptedStoredEvent(
  key: CryptoKey,
  event: StoredEventV1,
): Promise<Record<string, unknown>> {
  const eventKey = await deriveContextKeyFromCryptoKey(key, {
    vaultId,
    domain: "vault:event:v1",
    contextId: event.eventId,
    keyVersion: 1,
  });
  return decodeCanonicalCbor(
    await decryptEnvelope(decodeEncryptedEnvelopeBytes(event.envelopeBytes), eventKey),
  ) as Record<string, unknown>;
}

function item(status: "Active" | "Deleted", suffix: number): LibraryItemV1 {
  return {
    version: 1,
    bundleId: id(suffix),
    bundleObjectId: id(suffix + 10),
    assignedCollectionId: id(suffix + 20),
    title: `Capture ${String(suffix)}`,
    originalUrl: `https://fixture.test/${String(suffix)}`,
    capturedAt: "2026-07-17T00:00:00.000Z",
    screenshotPresent: false,
    status,
    warnings: [],
  };
}

describe("Vault Vacuum", () => {
  it("fails closed on an unsupported Event before committing deletions", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const deleted = item("Deleted", 20);
    const event = await storedEvent(key, id(40), deleted.bundleObjectId, {
      eventType: "UnknownFutureEvent",
    });
    let committed = false;
    const repository: VacuumRepository = {
      listStoredObjects: async () => [],
      listStoredEvents: async () => [event],
      acquireVacuum: async () => headWith([], [event.eventId]),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {},
      commitVacuum: async () => {
        committed = true;
      },
    };
    const library = {
      list: async () => [deleted],
      detail: async () => {
        throw new Error("Deleted detail should not be required for collection");
      },
    } as unknown as LibraryService;
    await expect(
      new VaultVacuumService(repository, library, key, vaultId, deviceId).execute(),
    ).rejects.toThrow("Unsupported Event type");
    expect(committed).toBe(false);
  });

  it("fails closed on an unsupported Object type before activation", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const deleted = item("Deleted", 20);
    let committed = false;
    const repository: VacuumRepository = {
      listStoredObjects: async () => [
        {
          version: 1,
          objectId: deleted.bundleObjectId,
          objectType: "UnknownFutureObject",
          envelopeBytes: new Uint8Array([1]),
        } as unknown as StoredObjectV1,
      ],
      listStoredEvents: async () => [],
      acquireVacuum: async () => headWith([deleted.bundleObjectId], []),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {},
      commitVacuum: async () => {
        committed = true;
      },
    };
    const library = { list: async () => [deleted] } as unknown as LibraryService;

    await expect(
      new VaultVacuumService(repository, library, key, vaultId, deviceId).execute(),
    ).rejects.toThrow("Unsupported Object type");
    expect(committed).toBe(false);
  });

  it("commits an encrypted successor manifest that retains only active Objects", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const active = item("Active", 20);
    const deleted = item("Deleted", 30);
    const objects: StoredObjectV1[] = [active, deleted].map((capture) => ({
      version: 1,
      objectId: capture.bundleObjectId,
      objectType: "Bundle",
      envelopeBytes: new Uint8Array([1, 2, 3]),
    }));
    const events = await Promise.all(
      [active, deleted].map((capture, index) =>
        storedEvent(key, id(50 + index), capture.bundleObjectId, {
          eventType: "BundleRegistered",
          bundleId: capture.bundleId,
        }),
      ),
    );
    let committed: Parameters<VacuumRepository["commitVacuum"]>[0] | undefined;
    const repository: VacuumRepository = {
      listStoredObjects: async () => objects,
      listStoredEvents: async () => events,
      acquireVacuum: async (): Promise<StoredVaultHeadV1> =>
        headWith(
          objects.map((object) => object.objectId),
          events.map((event) => event.eventId),
        ),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {},
      commitVacuum: async (input) => {
        committed = input;
      },
    };
    const library = {
      list: async () => [active, deleted],
      detail: async () => ({ item: active, metadata: {}, mhtml: new Uint8Array([1]) }),
    } as unknown as LibraryService;
    await expect(
      new VaultVacuumService(repository, library, key, vaultId, deviceId).execute(),
    ).resolves.toMatchObject({ deletedCaptureCount: 1 });
    if (committed === undefined) throw new Error("Vacuum did not commit");
    expect(committed.objectIds).toEqual([deleted.bundleObjectId]);
    expect(committed.head).toMatchObject({ vaultId, generationNumber: 1 });
    expect(committed.expectedGenerationId).toBe(initialHead.generationId);
    const generationKey = await deriveContextKeyFromCryptoKey(key, {
      vaultId,
      domain: "vault:generation:v1",
      contextId: committed.generation.generationId,
      keyVersion: 1,
    });
    const manifest = decodeCanonicalCbor(
      await decryptEnvelope(
        decodeEncryptedEnvelopeBytes(committed.generation.envelopeBytes),
        generationKey,
      ),
    );
    expect(manifest).toMatchObject({
      vaultId,
      generationNumber: 1,
      predecessorGenerationId: initialHead.generationId,
      retainedObjectIds: [active.bundleObjectId],
      reason: "Vacuum",
      integrity: { algorithm: "hash:sha256:v1" },
    });
  });

  it("aborts before activation when retained Event replay differs from Active", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const active = item("Active", 20);
    const deleted = item("Deleted", 30);
    let committed = false;
    let released = false;
    const repository: VacuumRepository = {
      listStoredObjects: async () => [
        {
          version: 1,
          objectId: active.bundleObjectId,
          objectType: "Bundle",
          envelopeBytes: new Uint8Array([1]),
        },
        {
          version: 1,
          objectId: deleted.bundleObjectId,
          objectType: "Bundle",
          envelopeBytes: new Uint8Array([2]),
        },
      ],
      listStoredEvents: async () => [
        await storedEvent(key, id(60), deleted.bundleObjectId, {
          eventType: "BundleRegistered",
          bundleId: deleted.bundleId,
        }),
      ],
      acquireVacuum: async () =>
        headWith([active.bundleObjectId, deleted.bundleObjectId], [id(60)]),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {
        released = true;
      },
      commitVacuum: async () => {
        committed = true;
      },
    };
    const library = {
      list: async () => [active, deleted],
      detail: async () => ({ item: active, metadata: {}, mhtml: new Uint8Array([1]) }),
    } as unknown as LibraryService;

    await expect(
      new VaultVacuumService(repository, library, key, vaultId, deviceId).execute(),
    ).rejects.toThrow("Retained Event replay does not match");
    expect(committed).toBe(false);
    expect(released).toBe(true);
  });

  it("rewrites mixed lifecycle Events under new IDs while preserving supported unknown fields", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const active = item("Active", 20);
    const deleted = item("Deleted", 30);
    const registrations = await Promise.all(
      [active, deleted].map((capture, index) =>
        storedEvent(key, id(70 + index), capture.bundleObjectId, {
          eventType: "BundleRegistered",
          bundleId: capture.bundleId,
        }),
      ),
    );
    const deletedEvent = await storedEvent(key, id(72), active.bundleObjectId, {
      eventType: "CapturesDeleted",
      bundleIds: [active.bundleId, deleted.bundleId],
      futureOptional: { preserve: true },
    });
    const restoredEvent = await storedEvent(key, id(73), active.bundleObjectId, {
      eventType: "CapturesRestored",
      bundleIds: [active.bundleId],
    });
    const events = [...registrations, deletedEvent, restoredEvent];
    const objects: StoredObjectV1[] = [active, deleted].map((capture) => ({
      version: 1,
      objectId: capture.bundleObjectId,
      objectType: "Bundle",
      envelopeBytes: new Uint8Array([1]),
    }));
    let committed: Parameters<VacuumRepository["commitVacuum"]>[0] | undefined;
    const repository: VacuumRepository = {
      listStoredObjects: async () => objects,
      listStoredEvents: async () => events,
      acquireVacuum: async () =>
        headWith(
          objects.map((object) => object.objectId),
          events.map((event) => event.eventId),
        ),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {},
      commitVacuum: async (input) => {
        committed = input;
      },
    };
    const library = {
      list: async () => [active, deleted],
      detail: async () => ({ item: active, metadata: {}, mhtml: new Uint8Array([1]) }),
    } as unknown as LibraryService;

    await new VaultVacuumService(repository, library, key, vaultId, deviceId).execute();
    if (committed === undefined) throw new Error("Vacuum did not commit");
    expect(committed.eventIds).toEqual([
      registrations[1]?.eventId,
      deletedEvent.eventId,
      restoredEvent.eventId,
    ]);
    expect(committed.eventsToAdd).toHaveLength(2);
    expect(committed.eventsToAdd.map((event) => event.eventId)).not.toContain(deletedEvent.eventId);
    const rewrittenDelete = await decryptedStoredEvent(
      key,
      committed.eventsToAdd[0] as StoredEventV1,
    );
    expect(rewrittenDelete).toMatchObject({
      eventType: "CapturesDeleted",
      bundleIds: [active.bundleId],
      futureOptional: { preserve: true },
      rewrite: { version: 1, sourceEventId: deletedEvent.eventId },
    });
  });

  it("retains Collection topology and rewrites mixed capture moves", async () => {
    const key = await rootKey();
    const sourceGeneration = await initialGeneration(key);
    const active = item("Active", 20);
    const deleted = item("Deleted", 30);
    const registrations = await Promise.all(
      [active, deleted].map((capture, index) =>
        storedEvent(key, id(80 + index), capture.bundleObjectId, {
          eventType: "BundleRegistered",
          bundleId: capture.bundleId,
          collectionId: capture.assignedCollectionId,
        }),
      ),
    );
    const moveEvent = await storedEvent(key, id(82), active.bundleObjectId, {
      eventType: "CapturesMoved",
      moves: [active, deleted].map((capture) => ({
        bundleId: capture.bundleId,
        fromCollectionId: capture.assignedCollectionId,
        toCollectionId: id(99),
      })),
    });
    const mergeEvent = await storedEvent(key, id(83), active.bundleObjectId, {
      eventType: "CollectionsMerged",
      destinationCollectionId: id(99),
      sourceCollectionIds: [active.assignedCollectionId],
    });
    const events = [...registrations, moveEvent, mergeEvent];
    const objects: StoredObjectV1[] = [active, deleted].map((capture) => ({
      version: 1,
      objectId: capture.bundleObjectId,
      objectType: "Bundle",
      envelopeBytes: new Uint8Array([1]),
    }));
    let committed: Parameters<VacuumRepository["commitVacuum"]>[0] | undefined;
    const repository: VacuumRepository = {
      listStoredObjects: async () => objects,
      listStoredEvents: async () => events,
      acquireVacuum: async () =>
        headWith(
          objects.map((object) => object.objectId),
          events.map((event) => event.eventId),
        ),
      updateVacuumStage: async () => {},
      getVaultGeneration: async () => sourceGeneration,
      releaseVacuum: async () => {},
      commitVacuum: async (input) => {
        committed = input;
      },
    };
    const library = {
      list: async () => [active, deleted],
      detail: async () => ({ item: active, metadata: {}, mhtml: new Uint8Array([1]) }),
    } as unknown as LibraryService;

    await new VaultVacuumService(repository, library, key, vaultId, deviceId).execute();
    if (committed === undefined) throw new Error("Vacuum did not commit");
    expect(committed.eventIds).toContain(moveEvent.eventId);
    expect(committed.eventIds).not.toContain(mergeEvent.eventId);
    const rewrittenMove = await decryptedStoredEvent(
      key,
      committed.eventsToAdd[0] as StoredEventV1,
    );
    expect(rewrittenMove).toMatchObject({
      eventType: "CapturesMoved",
      moves: [expect.objectContaining({ bundleId: active.bundleId })],
      rewrite: { version: 1, sourceEventId: moveEvent.eventId },
    });
  });
});
