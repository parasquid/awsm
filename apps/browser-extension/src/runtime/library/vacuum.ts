import {
  decodeEncryptedEnvelopeBytes,
  decryptEnvelope,
  encodeEncryptedEnvelope,
  encryptEnvelope,
} from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../domain/cbor";
import { record, string } from "../../domain/validation";
import type {
  StoredEventV1,
  StoredObjectV1,
  StoredVaultGenerationV1,
  StoredVaultHeadV1,
} from "../../drivers/indexeddb";
import { prepareVaultGeneration, verifyVaultGeneration } from "../vault/generation";
import type { LibraryService } from "./service";

export interface VacuumRepository {
  listStoredObjects(): Promise<readonly StoredObjectV1[]>;
  listStoredEvents(): Promise<readonly StoredEventV1[]>;
  acquireVacuum(jobId: string, createdAt: string): Promise<StoredVaultHeadV1>;
  updateVacuumStage(
    jobId: string,
    stage: "Preflight" | "Analyze" | "Rewrite" | "Verify",
  ): Promise<void>;
  getVaultGeneration(generationId: string): Promise<StoredVaultGenerationV1 | undefined>;
  releaseVacuum(jobId: string): Promise<void>;
  commitVacuum(input: {
    readonly jobId: string;
    readonly objectIds: readonly string[];
    readonly eventIds: readonly string[];
    readonly eventsToAdd: readonly StoredEventV1[];
    readonly bundleIds: readonly string[];
    readonly expectedGenerationId?: string;
    readonly generation: StoredVaultGenerationV1;
    readonly head: StoredVaultHeadV1;
  }): Promise<void>;
}

export interface VacuumResultV1 {
  readonly version: 1;
  readonly deletedCaptureCount: number;
  readonly reclaimedBytes: number;
}

async function eventPayload(
  event: StoredEventV1,
  rootKey: CryptoKey,
  vaultId: string,
): Promise<Record<string, unknown>> {
  const key = await deriveContextKeyFromCryptoKey(rootKey, {
    vaultId,
    domain: "vault:event:v1",
    contextId: event.eventId,
    keyVersion: 1,
  });
  try {
    const envelope = decodeEncryptedEnvelopeBytes(event.envelopeBytes);
    if (envelope.objectId !== event.eventId || envelope.objectType !== "Event") {
      throw new Error("Event envelope mismatch");
    }
    return record(decodeCanonicalCbor(await decryptEnvelope(envelope, key)), "event");
  } finally {
    await wipe(key);
  }
}

async function rewrittenEvent(
  source: StoredEventV1,
  payload: Record<string, unknown>,
  bundleIds: readonly string[],
  objectId: string,
  rootKey: CryptoKey,
  vaultId: string,
): Promise<StoredEventV1> {
  const eventId = crypto.randomUUID();
  const key = await deriveContextKeyFromCryptoKey(rootKey, {
    vaultId,
    domain: "vault:event:v1",
    contextId: eventId,
    keyVersion: 1,
  });
  try {
    return {
      version: 1,
      eventId,
      objectId,
      orderingTimestamp: source.orderingTimestamp,
      envelopeBytes: encodeEncryptedEnvelope(
        await encryptEnvelope({
          objectType: "Event",
          objectId: eventId,
          plaintext: encodeCanonicalCbor({
            ...payload,
            bundleIds: [...bundleIds].toSorted(),
            rewrite: { version: 1, sourceEventId: source.eventId },
          }),
          key,
        }),
      ),
    };
  } finally {
    await wipe(key);
  }
}

export class VaultVacuumService {
  constructor(
    readonly repository: VacuumRepository,
    readonly library: LibraryService,
    readonly rootKey: CryptoKey,
    readonly vaultId: string,
    readonly deviceId: string,
  ) {}

  async execute(): Promise<VacuumResultV1> {
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const currentHead = await this.repository.acquireVacuum(jobId, createdAt);
    let committed = false;
    try {
      return await this.executeWithLease(jobId, createdAt, currentHead, () => {
        committed = true;
      });
    } finally {
      if (!committed) await this.repository.releaseVacuum(jobId);
    }
  }

  private async executeWithLease(
    jobId: string,
    createdAt: string,
    currentHead: StoredVaultHeadV1,
    didCommit: () => void,
  ): Promise<VacuumResultV1> {
    const sourceGeneration = await this.repository.getVaultGeneration(currentHead.generationId);
    if (sourceGeneration === undefined) throw new Error("The active Vault Generation is missing.");
    const sourceManifest = await verifyVaultGeneration(
      this.rootKey,
      this.vaultId,
      sourceGeneration,
    );
    await this.repository.updateVacuumStage(jobId, "Analyze");
    const [items, objects, events] = await Promise.all([
      this.library.list(),
      this.repository.listStoredObjects(),
      this.repository.listStoredEvents(),
    ]);
    const rootedObjectIds = [
      ...sourceManifest.retainedObjectIds,
      ...currentHead.appendedObjectIds,
    ].toSorted();
    const rootedEventIds = [
      ...sourceManifest.retainedEventIds,
      ...currentHead.appendedEventIds,
    ].toSorted();
    if (
      rootedObjectIds.join("\n") !==
      objects
        .map((object) => object.objectId)
        .toSorted()
        .join("\n")
    ) {
      throw new Error("The active Vault Generation does not reach every stored Object.");
    }
    if (
      rootedEventIds.join("\n") !==
      events
        .map((event) => event.eventId)
        .toSorted()
        .join("\n")
    ) {
      throw new Error("The active Vault Generation does not reach every stored Event.");
    }
    const deleted = items.filter((item) => item.status === "Deleted");
    if (deleted.length === 0) throw new Error("Deleted is empty.");

    // Authentication of every retained Bundle is the pre-activation verification boundary.
    await Promise.all(
      items
        .filter((item) => item.status === "Active")
        .map((item) => this.library.detail(item.bundleId)),
    );

    const deletedBundleIds = new Set(deleted.map((item) => item.bundleId));
    const deletedObjectIds = new Set(deleted.map((item) => item.bundleObjectId));
    const activeBundleIds = new Set(
      items.filter((item) => item.status === "Active").map((item) => item.bundleId),
    );
    const replayState = new Map<string, "Active" | "Deleted">();
    for (const object of objects) {
      if (object.objectType !== "Bundle") {
        throw new Error(`Unsupported Object type during Vault Vacuum: ${object.objectType}`);
      }
    }
    const eventIds: string[] = [];
    const eventsToAdd: StoredEventV1[] = [];
    let eventBytes = 0;
    let rewrittenEventBytes = 0;
    const orderedEvents = [...events].toSorted(
      (left, right) =>
        left.orderingTimestamp.localeCompare(right.orderingTimestamp) ||
        left.eventId.localeCompare(right.eventId),
    );
    for (const event of orderedEvents) {
      const payload = await eventPayload(event, this.rootKey, this.vaultId);
      const eventType = string(payload.eventType, "event.eventType");
      if (eventType === "BundleRegistered") {
        const bundleId = string(payload.bundleId, "event.bundleId");
        if (deletedBundleIds.has(bundleId)) {
          eventIds.push(event.eventId);
          eventBytes += event.envelopeBytes.byteLength;
          continue;
        }
        if (replayState.has(bundleId)) {
          throw new Error("Retained Event history registers a Bundle more than once.");
        }
        replayState.set(bundleId, "Active");
        continue;
      }
      if (eventType === "CapturesDeleted" || eventType === "CapturesRestored") {
        eventIds.push(event.eventId);
        eventBytes += event.envelopeBytes.byteLength;
        if (!Array.isArray(payload.bundleIds))
          throw new Error("Lifecycle Event Bundle IDs are invalid.");
        const retainedIds = payload.bundleIds
          .map((value, index) => string(value, `event.bundleIds.${String(index)}`))
          .filter((bundleId) => activeBundleIds.has(bundleId))
          .toSorted();
        if (retainedIds.length > 0) {
          const first = items.find((item) => item.bundleId === retainedIds[0]);
          if (first === undefined) throw new Error("Rewritten Event references a missing Bundle.");
          const rewritten = await rewrittenEvent(
            event,
            payload,
            retainedIds,
            first.bundleObjectId,
            this.rootKey,
            this.vaultId,
          );
          eventsToAdd.push(rewritten);
          rewrittenEventBytes += rewritten.envelopeBytes.byteLength;
          const status = eventType === "CapturesDeleted" ? "Deleted" : "Active";
          for (const bundleId of retainedIds) replayState.set(bundleId, status);
        }
        continue;
      }
      throw new Error(`Unsupported Event type during Vault Vacuum: ${eventType}`);
    }
    if (
      [...activeBundleIds].toSorted().join("\n") !==
        [...replayState.keys()].toSorted().join("\n") ||
      [...replayState.values()].some((status) => status !== "Active")
    ) {
      throw new Error("Retained Event replay does not match the active Library state.");
    }
    const objectBytes = objects
      .filter((object) => deletedObjectIds.has(object.objectId))
      .reduce((total, object) => total + object.envelopeBytes.byteLength, 0);
    const generationId = crypto.randomUUID();
    const generationNumber = currentHead.generationNumber + 1;
    const retainedObjectIds = objects
      .filter((object) => !deletedObjectIds.has(object.objectId))
      .map((object) => object.objectId)
      .toSorted();
    const deletedEventIds = new Set(eventIds);
    const retainedEventIds = events
      .filter((event) => !deletedEventIds.has(event.eventId))
      .map((event) => event.eventId)
      .concat(eventsToAdd.map((event) => event.eventId))
      .toSorted();
    await this.repository.updateVacuumStage(jobId, "Rewrite");
    const { generation, head } = await prepareVaultGeneration({
      rootKey: this.rootKey,
      vaultId: this.vaultId,
      deviceId: this.deviceId,
      generationId,
      generationNumber,
      predecessorGenerationId: currentHead.generationId,
      createdAt,
      reason: "Vacuum",
      retainedObjectIds,
      retainedEventIds,
    });
    await this.repository.updateVacuumStage(jobId, "Verify");
    await verifyVaultGeneration(this.rootKey, this.vaultId, generation);
    await this.repository.commitVacuum({
      jobId,
      objectIds: [...deletedObjectIds].toSorted(),
      eventIds: eventIds.toSorted(),
      eventsToAdd,
      bundleIds: [...deletedBundleIds].toSorted(),
      expectedGenerationId: currentHead.generationId,
      generation,
      head,
    });
    didCommit();
    return {
      version: 1,
      deletedCaptureCount: deleted.length,
      reclaimedBytes: Math.max(0, objectBytes + eventBytes - rewrittenEventBytes),
    };
  }
}
