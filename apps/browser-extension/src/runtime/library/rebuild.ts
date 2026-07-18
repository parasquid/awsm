import {
  decodeEncryptedEnvelopeBytes,
  decryptEnvelope,
  encodeEncryptedEnvelope,
  encryptEnvelope,
} from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../domain/cbor";
import { CAPTURE_WARNINGS, type CaptureWarningId } from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import { boolean, httpUrl, record, string, timestamp, uuid } from "../../domain/validation";
import type {
  StoredCollectionProjectionV1,
  StoredEvent,
  StoredProjectionV1,
  StoredVaultNameProjectionV1,
} from "../../drivers/indexeddb";
import { decodeVaultNameEvent, encryptVaultNameProjection } from "../vault/name-crypto";
import { reduceVaultNameProjection, type VaultNameEventV1 } from "../vault/name-projection";
import type { CollectionTopologyEventV1 } from "./collections";
import { type LibraryProjectionEventV1, reduceLibraryProjection } from "./projection";
import { assertCanonicalEventFields } from "./vacuum";

export interface LibraryProjectionRebuildRepository {
  listStoredEvents(): Promise<readonly StoredEvent[]>;
  replaceLibraryProjections(
    itemProjections: readonly StoredProjectionV1[],
    collectionProjection: StoredCollectionProjectionV1,
    vaultNameProjection: StoredVaultNameProjectionV1,
  ): Promise<void>;
}

function warnings(value: unknown): readonly CaptureWarningId[] {
  if (!Array.isArray(value)) throw new DomainValidationError("event.warnings", "must be an array");
  return value.map((warning, index) => {
    if (typeof warning !== "string" || !CAPTURE_WARNINGS.includes(warning as CaptureWarningId)) {
      throw new DomainValidationError(`event.warnings.${String(index)}`, "is unsupported");
    }
    return warning as CaptureWarningId;
  });
}

async function decryptEvent(
  event: StoredEvent,
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
      throw new DomainValidationError("event", "has a mismatched envelope");
    }
    return record(decodeCanonicalCbor(await decryptEnvelope(envelope, key)), "event");
  } finally {
    await wipe(key);
  }
}

async function projectionBytes(
  plaintext: unknown,
  objectId: string,
  contextId: string,
  rootKey: CryptoKey,
  vaultId: string,
): Promise<Uint8Array> {
  const key = await deriveContextKeyFromCryptoKey(rootKey, {
    vaultId,
    domain: "vault:projection:v1",
    contextId,
    keyVersion: 1,
  });
  try {
    return encodeEncryptedEnvelope(
      await encryptEnvelope({
        objectType: "Projection",
        objectId,
        plaintext: encodeCanonicalCbor(plaintext),
        key,
      }),
    );
  } finally {
    await wipe(key);
  }
}

export class LibraryProjectionRebuilder {
  constructor(
    readonly repository: LibraryProjectionRebuildRepository,
    readonly rootKey: CryptoKey,
    readonly vaultId: string,
  ) {}

  async execute(): Promise<void> {
    const events = (await this.repository.listStoredEvents()).toSorted(
      (left, right) =>
        left.orderingTimestamp.localeCompare(right.orderingTimestamp) ||
        left.eventId.localeCompare(right.eventId),
    );
    const itemEvents: LibraryProjectionEventV1[] = [];
    const topologyEvents: CollectionTopologyEventV1[] = [];
    const vaultNameEvents: VaultNameEventV1[] = [];
    for (const event of events) {
      const payload = await decryptEvent(event, this.rootKey, this.vaultId);
      const eventType = string(payload.eventType, "event.eventType");
      assertCanonicalEventFields(payload, eventType);
      if (eventType === "VaultCreated" || eventType === "VaultRenamed") {
        vaultNameEvents.push(await decodeVaultNameEvent(this.rootKey, event));
        continue;
      }
      if (eventType === "BundleRegistered") {
        const metadata = record(payload.captureMetadata, "event.captureMetadata");
        itemEvents.push({
          eventId: event.eventId,
          eventType,
          bundleId: uuid(payload.bundleId, "event.bundleId"),
          bundleObjectId: uuid(payload.bundleObjectId, "event.bundleObjectId"),
          collectionId: uuid(payload.collectionId, "event.collectionId"),
          title: string(metadata.title, "event.captureMetadata.title"),
          originalUrl: httpUrl(metadata.originalUrl, "event.captureMetadata.originalUrl"),
          capturedAt: timestamp(payload.timestamp, "event.timestamp"),
          screenshotPresent: boolean(payload.screenshotPresent, "event.screenshotPresent"),
          warnings: warnings(payload.warnings),
        });
        continue;
      }
      if (eventType === "CapturesDeleted" || eventType === "CapturesRestored") {
        if (!Array.isArray(payload.bundleIds)) {
          throw new DomainValidationError("event.bundleIds", "must be an array");
        }
        itemEvents.push({
          eventId: event.eventId,
          eventType,
          bundleIds: payload.bundleIds.map((value, index) =>
            uuid(value, `event.bundleIds.${String(index)}`),
          ),
        });
        continue;
      }
      if (eventType === "CapturesMoved") {
        if (!Array.isArray(payload.moves)) {
          throw new DomainValidationError("event.moves", "must be an array");
        }
        itemEvents.push({
          eventId: event.eventId,
          eventType,
          moves: payload.moves.map((value, index) => {
            const move = record(value, `event.moves.${String(index)}`);
            return {
              bundleId: uuid(move.bundleId, `event.moves.${String(index)}.bundleId`),
              fromCollectionId: uuid(
                move.fromCollectionId,
                `event.moves.${String(index)}.fromCollectionId`,
              ),
              toCollectionId: uuid(
                move.toCollectionId,
                `event.moves.${String(index)}.toCollectionId`,
              ),
            };
          }),
        });
        continue;
      }
      if (eventType === "CollectionsMerged") {
        if (!Array.isArray(payload.sourceCollectionIds)) {
          throw new DomainValidationError("event.sourceCollectionIds", "must be an array");
        }
        topologyEvents.push({
          eventId: event.eventId,
          eventType,
          destinationCollectionId: uuid(
            payload.destinationCollectionId,
            "event.destinationCollectionId",
          ),
          sourceCollectionIds: payload.sourceCollectionIds.map((value, index) =>
            uuid(value, `event.sourceCollectionIds.${String(index)}`),
          ),
        });
        continue;
      }
      if (eventType === "CollectionMergeReverted") {
        topologyEvents.push({
          eventId: event.eventId,
          eventType,
          mergeEventId: uuid(payload.mergeEventId, "event.mergeEventId"),
        });
        continue;
      }
      throw new Error(`Unsupported Event type during Projection rebuild: ${eventType}`);
    }

    const items = reduceLibraryProjection(itemEvents);
    const itemProjections = await Promise.all(
      items.map(
        async (item): Promise<StoredProjectionV1> => ({
          version: 1,
          bundleId: item.bundleId,
          envelopeBytes: await projectionBytes(
            item,
            item.bundleId,
            `LibraryItem-v1:${item.bundleId}`,
            this.rootKey,
            this.vaultId,
          ),
        }),
      ),
    );
    const collectionProjection: StoredCollectionProjectionV1 = {
      version: 1,
      projectionId: this.vaultId,
      envelopeBytes: await projectionBytes(
        { version: 1, topologyEvents },
        this.vaultId,
        `LibraryCollections-v1:${this.vaultId}`,
        this.rootKey,
        this.vaultId,
      ),
    };
    const vaultNameProjection = await encryptVaultNameProjection(
      this.rootKey,
      reduceVaultNameProjection(vaultNameEvents),
    );
    await this.repository.replaceLibraryProjections(
      itemProjections,
      collectionProjection,
      vaultNameProjection,
    );
  }
}
