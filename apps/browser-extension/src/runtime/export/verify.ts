import { decodeEncryptedEnvelopeBytes, decryptEnvelope } from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { readBundle } from "../../domain/bundle";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../domain/cbor";
import { bytesEqual, sha256 } from "../../domain/hash";
import {
  bytes,
  canonicalRecord,
  integer,
  literal,
  record,
  string,
  timestamp,
  uuid,
} from "../../domain/validation";
import {
  decodeStoredEvent,
  decodeStoredObject,
  decodeStoredVaultGeneration,
} from "../../drivers/indexeddb/decode";
import type { StoredEvent, StoredVaultHeadV1 } from "../../drivers/indexeddb/schema";
import { assertCanonicalEventFields } from "../library/vacuum";
import { verifyVaultGeneration } from "../vault/generation";
import { normalizeVaultName } from "../vault/name";
import type { ExportManifestV1 } from "./contracts";

interface Registration {
  readonly bundleId: string;
  readonly objectId: string;
  readonly byteLength: number;
  readonly checksum: Uint8Array;
  readonly captureMetadata: Record<string, unknown>;
  readonly screenshotPresent: boolean;
}

function idArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map((entry, index) => uuid(entry, `${field}.${index}`));
  if (
    result.length !== new Set(result).size ||
    result.join("\n") !== [...result].toSorted().join("\n")
  ) {
    throw new Error(`${field} must be sorted and unique`);
  }
  return result;
}

function decodeHead(value: unknown): StoredVaultHeadV1 {
  const input = canonicalRecord(value, "head", [
    "version",
    "vaultId",
    "generationId",
    "generationNumber",
    "appendedObjectIds",
    "appendedEventIds",
  ]);
  return {
    version: literal(input.version, 1, "head.version"),
    vaultId: uuid(input.vaultId, "head.vaultId"),
    generationId: uuid(input.generationId, "head.generationId"),
    generationNumber: integer(input.generationNumber, "head.generationNumber"),
    appendedObjectIds: idArray(input.appendedObjectIds, "head.appendedObjectIds"),
    appendedEventIds: idArray(input.appendedEventIds, "head.appendedEventIds"),
  };
}

async function eventPayload(
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
    if (envelope.objectType !== "Event" || envelope.objectId !== event.eventId)
      throw new Error("Event envelope mismatch");
    return record(decodeCanonicalCbor(await decryptEnvelope(envelope, key)), "event");
  } finally {
    await wipe(key);
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function verifyAuthoritativeVaultPackage(input: {
  readonly manifest: ExportManifestV1;
  readonly rootKey: CryptoKey;
  readonly read: (path: string, maximum: number) => Promise<Uint8Array>;
}): Promise<void> {
  const { manifest, rootKey, read } = input;
  const generation = decodeStoredVaultGeneration(
    decodeCanonicalCbor(await read("generation.cbor", 16 * 1024 * 1024)),
  );
  const head = decodeHead(decodeCanonicalCbor(await read("head.cbor", 16 * 1024 * 1024)));
  if (
    generation.generationId !== manifest.generationId ||
    generation.generationNumber !== manifest.generationNumber ||
    head.vaultId !== manifest.originatingVaultId ||
    head.generationId !== generation.generationId ||
    head.generationNumber !== generation.generationNumber
  )
    throw new Error("Generation identity mismatch");
  const retained = await verifyVaultGeneration(rootKey, manifest.originatingVaultId, generation);
  const expectedEventIds = [...retained.retainedEventIds, ...head.appendedEventIds].toSorted();
  const expectedObjectIds = [...retained.retainedObjectIds, ...head.appendedObjectIds].toSorted();
  if (
    new Set(expectedEventIds).size !== expectedEventIds.length ||
    new Set(expectedObjectIds).size !== expectedObjectIds.length
  ) {
    throw new Error("Duplicate Generation reachability");
  }
  const eventDescriptors = manifest.entries.filter((entry) => entry.recordType === "Event");
  const objectDescriptors = manifest.entries.filter((entry) => entry.recordType === "Object");
  if (
    !sameIds(expectedEventIds, eventDescriptors.map((entry) => entry.recordId).toSorted()) ||
    !sameIds(expectedObjectIds, objectDescriptors.map((entry) => entry.recordId).toSorted())
  ) {
    throw new Error("Manifest reachability mismatch");
  }

  const registrations = new Map<string, Registration>();
  const referencedObjects = new Set<string>();
  const knownBundles = new Set<string>();
  const bundleStates = new Map<string, "Active" | "Deleted">();
  const bundleCollections = new Map<string, string>();
  const merges = new Set<string>();
  const revertedMerges = new Set<string>();
  let vaultCreated = false;
  const orderedEvents: {
    readonly stored: StoredEvent;
    readonly payload: Record<string, unknown>;
  }[] = [];
  for (const descriptor of eventDescriptors) {
    const stored = decodeStoredEvent(
      decodeCanonicalCbor(await read(descriptor.path, descriptor.byteLength)),
    );
    if (stored.eventId !== descriptor.recordId || stored.vaultId !== manifest.originatingVaultId)
      throw new Error("Stored Event identity mismatch");
    for (const objectId of stored.referencedObjectIds) referencedObjects.add(objectId);
    const payload = await eventPayload(stored, rootKey, manifest.originatingVaultId);
    const eventType = string(payload.eventType, "event.eventType");
    assertCanonicalEventFields(payload, eventType);
    literal(payload.version, 1, "event.version");
    literal(payload.eventVersion, 1, "event.eventVersion");
    literal(payload.payloadVersion, 1, "event.payloadVersion");
    if (uuid(payload.vaultId, "event.vaultId") !== manifest.originatingVaultId)
      throw new Error("Event Vault mismatch");
    uuid(payload.deviceId, "event.deviceId");
    if (timestamp(payload.timestamp, "event.timestamp") !== stored.orderingTimestamp)
      throw new Error("Event timestamp mismatch");
    orderedEvents.push({ stored, payload });
  }
  orderedEvents.sort(
    (left, right) =>
      left.stored.orderingTimestamp.localeCompare(right.stored.orderingTimestamp) ||
      left.stored.eventId.localeCompare(right.stored.eventId),
  );
  for (const { stored, payload } of orderedEvents) {
    const eventType = string(payload.eventType, "event.eventType");
    if (eventType === "VaultCreated" || eventType === "VaultRenamed") {
      if (normalizeVaultName(string(payload.name, "event.name")) !== payload.name)
        throw new Error("Vault name is not canonical");
      if (stored.referencedObjectIds.length !== 0)
        throw new Error("Vault name Event references an Object");
      if (eventType === "VaultCreated") {
        if (vaultCreated) throw new Error("Vault is created more than once");
        vaultCreated = true;
      } else if (!vaultCreated) throw new Error("Vault Rename precedes creation");
    } else if (eventType === "BundleRegistered") {
      literal(payload.protocolVersion, 1, "event.protocolVersion");
      uuid(payload.correlationId, "event.correlationId");
      const bundleId = uuid(payload.bundleId, "event.bundleId");
      const objectId = uuid(payload.bundleObjectId, "event.bundleObjectId");
      const collectionId = uuid(payload.collectionId, "event.collectionId");
      literal(payload.captureProfileId, "ChromeWebPage-v1", "event.captureProfileId");
      if (typeof payload.screenshotPresent !== "boolean")
        throw new Error("Bundle screenshot state is invalid");
      const captureMetadata = record(payload.captureMetadata, "event.captureMetadata");
      if (!Array.isArray(payload.warnings)) throw new Error("Bundle warnings are invalid");
      if (
        knownBundles.has(bundleId) ||
        registrations.has(objectId) ||
        !sameIds(stored.referencedObjectIds, [objectId])
      ) {
        throw new Error("Bundle registration is not one-to-one");
      }
      const integrity = canonicalRecord(payload.integrity, "event.integrity", [
        "algorithm",
        "checksum",
        "byteLength",
      ]);
      literal(integrity.algorithm, "hash:sha256:v1", "event.integrity.algorithm");
      registrations.set(objectId, {
        bundleId,
        objectId,
        byteLength: integer(integrity.byteLength, "event.integrity.byteLength"),
        checksum: bytes(integrity.checksum, 32, "event.integrity.checksum"),
        captureMetadata,
        screenshotPresent: payload.screenshotPresent,
      });
      knownBundles.add(bundleId);
      bundleStates.set(bundleId, "Active");
      bundleCollections.set(bundleId, collectionId);
    } else if (eventType === "CapturesDeleted" || eventType === "CapturesRestored") {
      const from = eventType === "CapturesDeleted" ? "Active" : "Deleted";
      const to = eventType === "CapturesDeleted" ? "Deleted" : "Active";
      for (const id of idArray(payload.bundleIds, "event.bundleIds")) {
        if (!knownBundles.has(id) || bundleStates.get(id) !== from)
          throw new Error("Lifecycle Event cannot replay from current state");
        bundleStates.set(id, to);
      }
    } else if (eventType === "CapturesMoved") {
      if (!Array.isArray(payload.moves)) throw new Error("Moves must be an array");
      for (const [index, value] of payload.moves.entries()) {
        const move = canonicalRecord(value, `event.moves.${index}`, [
          "bundleId",
          "fromCollectionId",
          "toCollectionId",
        ]);
        const bundleId = uuid(move.bundleId, `event.moves.${index}.bundleId`);
        const fromCollectionId = uuid(
          move.fromCollectionId,
          `event.moves.${index}.fromCollectionId`,
        );
        const toCollectionId = uuid(move.toCollectionId, `event.moves.${index}.toCollectionId`);
        if (!knownBundles.has(bundleId)) throw new Error("Move references unknown Bundle");
        if (bundleCollections.get(bundleId) !== fromCollectionId)
          throw new Error("Move cannot replay from current Collection");
        bundleCollections.set(bundleId, toCollectionId);
      }
    } else if (eventType === "CollectionsMerged") {
      uuid(payload.destinationCollectionId, "event.destinationCollectionId");
      idArray(payload.sourceCollectionIds, "event.sourceCollectionIds");
      merges.add(stored.eventId);
    } else if (eventType === "CollectionMergeReverted") {
      const mergeEventId = uuid(payload.mergeEventId, "event.mergeEventId");
      if (!merges.has(mergeEventId) || revertedMerges.has(mergeEventId))
        throw new Error("Collection merge reversion cannot replay");
      revertedMerges.add(mergeEventId);
    }
  }
  if (!vaultCreated) throw new Error("Vault creation Event is missing");
  if (!sameIds([...referencedObjects].toSorted(), expectedObjectIds))
    throw new Error("Object references do not match reachability");
  if (!sameIds([...registrations.keys()].toSorted(), expectedObjectIds))
    throw new Error("Every Object must have one Bundle registration");

  for (const descriptor of objectDescriptors) {
    const stored = decodeStoredObject(
      decodeCanonicalCbor(await read(descriptor.path, descriptor.byteLength)),
    );
    const registration = registrations.get(stored.objectId);
    if (
      stored.objectId !== descriptor.recordId ||
      stored.objectType !== "Bundle" ||
      registration === undefined
    )
      throw new Error("Stored Object identity mismatch");
    const key = await deriveContextKeyFromCryptoKey(rootKey, {
      vaultId: manifest.originatingVaultId,
      domain: "vault:bundle:v1",
      contextId: registration.bundleId,
      keyVersion: 1,
    });
    try {
      const envelope = decodeEncryptedEnvelopeBytes(stored.envelopeBytes);
      if (envelope.objectType !== "Bundle" || envelope.objectId !== stored.objectId)
        throw new Error("Bundle envelope mismatch");
      const plaintext = await decryptEnvelope(envelope, key);
      if (
        plaintext.byteLength !== registration.byteLength ||
        !bytesEqual(await sha256(plaintext), registration.checksum)
      ) {
        throw new Error("Bundle registration integrity mismatch");
      }
      const bundle = await readBundle(plaintext);
      if (
        bundle.manifest.bundleId !== registration.bundleId ||
        !bytesEqual(
          encodeCanonicalCbor(bundle.metadata),
          encodeCanonicalCbor(registration.captureMetadata),
        ) ||
        bundle.artifacts.has("SCREENSHOT_FULL") !== registration.screenshotPresent
      ) {
        throw new Error("Bundle content does not match its registration Event");
      }
    } finally {
      await wipe(key);
    }
  }
}
