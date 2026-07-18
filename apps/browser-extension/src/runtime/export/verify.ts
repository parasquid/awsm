import { readArtifactEnvelope } from "../../crypto/artifact-envelope";
import { decodeEncryptedEnvelopeBytes, decryptEnvelope } from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { type BundleDescriptorV1, decodeBundleDescriptor } from "../../domain/artifact-graph";
import { decodeCanonicalCbor } from "../../domain/cbor";
import type { CaptureWarningId } from "../../domain/contracts";
import { bytesEqual } from "../../domain/hash";
import {
  decodeStructuredContentSequence,
  normalizedTextFromBlocks,
} from "../../domain/structured-content";
import {
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
import { decodeBundleRegisteredPayload, validateArtifactWarnings } from "../capture/contracts";
import { assertCanonicalEventFields } from "../library/vacuum";
import { verifyVaultGeneration } from "../vault/generation";
import { normalizeVaultName } from "../vault/name";
import type { ExportManifestV1 } from "./contracts";

interface Registration {
  readonly bundleId: string;
  readonly descriptorObjectId: string;
  readonly artifactObjectIds: readonly string[];
  readonly warnings: readonly CaptureWarningId[];
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
  readonly openArtifact: (objectId: string) => Promise<ReadableStream<Uint8Array>>;
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
      const registration = decodeBundleRegisteredPayload(payload, stored.referencedObjectIds);
      const { bundleId, descriptorObjectId, artifactObjectIds, collectionId } = registration;
      if (knownBundles.has(bundleId) || registrations.has(descriptorObjectId)) {
        throw new Error("Bundle registration is not one-to-one");
      }
      registrations.set(descriptorObjectId, {
        bundleId,
        descriptorObjectId,
        artifactObjectIds,
        warnings: registration.warnings,
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
  const objects = new Map<string, ReturnType<typeof decodeStoredObject>>();
  for (const descriptor of objectDescriptors) {
    const stored = decodeStoredObject(
      decodeCanonicalCbor(await read(descriptor.path, descriptor.byteLength)),
    );
    if (stored.objectId !== descriptor.recordId || objects.has(stored.objectId))
      throw new Error("Stored Object identity mismatch");
    objects.set(stored.objectId, stored);
  }
  const reachableFromRegistrations = [...registrations.values()]
    .flatMap((registration) => [registration.descriptorObjectId, ...registration.artifactObjectIds])
    .toSorted();
  if (!sameIds(reachableFromRegistrations, expectedObjectIds))
    throw new Error("Every Object must belong to one registration closure");

  const payloadDescriptors = new Map(
    manifest.entries
      .filter((entry) => entry.recordType === "ArtifactPayload")
      .map((entry) => [entry.recordId, entry]),
  );
  const omissionById = new Map(manifest.omissions.map((entry) => [entry.artifactObjectId, entry]));
  for (const registration of registrations.values()) {
    const stored = objects.get(registration.descriptorObjectId);
    if (stored?.objectType !== "BundleDescriptor") throw new Error("Descriptor Object missing");
    const key = await deriveContextKeyFromCryptoKey(rootKey, {
      vaultId: manifest.originatingVaultId,
      domain: "vault:bundle-descriptor:v1",
      contextId: registration.bundleId,
      keyVersion: 1,
    });
    let bundleDescriptor: BundleDescriptorV1;
    try {
      const envelope = decodeEncryptedEnvelopeBytes(stored.envelopeBytes);
      if (envelope.objectType !== "BundleDescriptor" || envelope.objectId !== stored.objectId)
        throw new Error("Descriptor envelope mismatch");
      bundleDescriptor = decodeBundleDescriptor(await decryptEnvelope(envelope, key));
    } finally {
      await wipe(key);
    }
    if (
      bundleDescriptor.bundleId !== registration.bundleId ||
      !sameIds(
        bundleDescriptor.artifacts.map((artifact) => artifact.artifactObjectId),
        registration.artifactObjectIds,
      )
    )
      throw new Error("Descriptor does not match Event closure");
    validateArtifactWarnings(
      bundleDescriptor.artifacts.map((artifact) => artifact.role),
      registration.warnings,
    );
    const decodedPayloads = new Map<string, Uint8Array>();
    for (const reference of bundleDescriptor.artifacts) {
      const artifact = objects.get(reference.artifactObjectId);
      if (artifact?.objectType !== "Artifact") throw new Error("Artifact Object missing");
      const payload = payloadDescriptors.get(reference.artifactObjectId);
      const omission = omissionById.get(reference.artifactObjectId);
      if ((payload === undefined) === (omission === undefined))
        throw new Error("Artifact must be exactly present or omitted");
      if (omission !== undefined) {
        if (reference.role !== "PRIMARY" && reference.role !== "SCREENSHOT_FULL")
          throw new Error("Compact Artifact cannot be omitted");
        if (
          omission.envelopeByteLength !== artifact.envelopeByteLength ||
          !bytesEqual(omission.envelopeChecksum, artifact.envelopeChecksum)
        )
          throw new Error("Artifact omission does not match Object record");
        continue;
      }
      if (
        payload?.byteLength !== artifact.envelopeByteLength ||
        !bytesEqual(payload.checksum, artifact.envelopeChecksum)
      )
        throw new Error("Artifact payload descriptor does not match Object record");
      const artifactKey = await deriveContextKeyFromCryptoKey(rootKey, {
        vaultId: manifest.originatingVaultId,
        domain: "vault:artifact:v1",
        contextId: artifact.objectId,
        keyVersion: 1,
      });
      try {
        const compact =
          reference.role === "TEXT_EXTRACTED" || reference.role === "CONTENT_STRUCTURED";
        if (compact && reference.plaintextByteLength > 16 * 1024 * 1024)
          throw new Error("Compact Artifact exceeds validation bound");
        const chunks: Uint8Array[] = [];
        const prefix = new Uint8Array(16);
        let prefixLength = 0;
        const summary = await readArtifactEnvelope({
          expectedObjectId: artifact.objectId,
          key: artifactKey,
          encrypted: await input.openArtifact(artifact.objectId),
          write: (chunk: Uint8Array) => {
            if (compact) chunks.push(Uint8Array.from(chunk));
            if (prefixLength < prefix.byteLength) {
              const length = Math.min(prefix.byteLength - prefixLength, chunk.byteLength);
              prefix.set(chunk.subarray(0, length), prefixLength);
              prefixLength += length;
            }
          },
        });
        if (
          summary.envelopeByteLength !== artifact.envelopeByteLength ||
          !bytesEqual(summary.envelopeChecksum, artifact.envelopeChecksum)
        )
          throw new Error("Artifact wrapper does not match Object record");
        if (
          summary.plaintextByteLength !== reference.plaintextByteLength ||
          !bytesEqual(summary.plaintextChecksum, reference.plaintextChecksum)
        )
          throw new Error("Artifact plaintext does not match descriptor reference");
        if (reference.role === "SCREENSHOT_FULL" || reference.role === "THUMBNAIL") {
          const header = new TextDecoder().decode(prefix.subarray(0, 12));
          if (!header.startsWith("RIFF") || !header.endsWith("WEBP"))
            throw new Error("Image Artifact is not WebP");
        }
        if (reference.role === "PRIMARY" && prefixLength === 0)
          throw new Error("MHTML Artifact is empty");
        const plaintext = new Uint8Array(
          chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          plaintext.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (compact) decodedPayloads.set(reference.role, plaintext);
      } finally {
        await wipe(artifactKey);
      }
    }
    const structured = decodedPayloads.get("CONTENT_STRUCTURED");
    const text = decodedPayloads.get("TEXT_EXTRACTED");
    if (structured !== undefined) {
      const blocks = decodeStructuredContentSequence(structured);
      if (text !== undefined && !bytesEqual(text, normalizedTextFromBlocks(blocks)))
        throw new Error("Normalized text does not match structured content");
    }
  }
}
