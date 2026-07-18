import { encodeEncryptedEnvelope, encryptEnvelope } from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { buildBundle, type CaptureMetadataV1, readBundle } from "../../domain/bundle";
import { encodeCanonicalCbor } from "../../domain/cbor";
import type { CaptureWarningId } from "../../domain/contracts";
import { sha256 } from "../../domain/hash";
import type { AtomicRegistrationV1 } from "../../drivers/indexeddb";
import { reduceLibraryProjection } from "../library/projection";

export interface PrepareCaptureRegistrationInput {
  readonly rootKey: CryptoKey;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly commandId: string;
  readonly bundleId: string;
  readonly bundleObjectId: string;
  readonly eventId: string;
  readonly capturedAt: string;
  readonly metadata: CaptureMetadataV1;
  readonly mhtml: Uint8Array;
  readonly screenshot?: Uint8Array;
  readonly thumbnailPng?: Uint8Array;
  readonly warnings: readonly CaptureWarningId[];
  readonly clientVersion: string;
}

async function encryptedBytes(
  input: PrepareCaptureRegistrationInput,
  domain: "vault:bundle:v1" | "vault:event:v1" | "vault:projection:v1",
  contextId: string,
  objectType: "Bundle" | "Event" | "Projection",
  objectId: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveContextKeyFromCryptoKey(input.rootKey, {
    vaultId: input.vaultId,
    domain,
    contextId,
    keyVersion: 1,
  });
  try {
    return encodeEncryptedEnvelope(await encryptEnvelope({ objectType, objectId, plaintext, key }));
  } finally {
    await wipe(key);
  }
}

export async function prepareCaptureRegistration(
  input: PrepareCaptureRegistrationInput,
): Promise<AtomicRegistrationV1> {
  const built = await buildBundle({
    bundleId: input.bundleId,
    createdAt: input.capturedAt,
    clientVersion: input.clientVersion,
    metadata: input.metadata,
    mhtml: input.mhtml,
    ...(input.screenshot === undefined ? {} : { screenshot: input.screenshot }),
  });
  await readBundle(built.bytes);

  const integrityChecksum = await sha256(built.bytes);
  const eventPlaintext = encodeCanonicalCbor({
    version: 1,
    eventType: "BundleRegistered",
    eventVersion: 1,
    payloadVersion: 1,
    vaultId: input.vaultId,
    deviceId: input.deviceId,
    timestamp: input.capturedAt,
    protocolVersion: 1,
    correlationId: input.commandId,
    bundleId: input.bundleId,
    bundleObjectId: input.bundleObjectId,
    captureProfileId: "ChromeWebPage-v1",
    captureMetadata: input.metadata,
    warnings: input.warnings,
    integrity: {
      algorithm: "hash:sha256:v1",
      checksum: integrityChecksum,
      byteLength: built.bytes.byteLength,
    },
  });
  const projection = reduceLibraryProjection([
    {
      eventId: input.eventId,
      eventType: "BundleRegistered",
      bundleId: input.bundleId,
      bundleObjectId: input.bundleObjectId,
      title: input.metadata.title,
      originalUrl: input.metadata.originalUrl,
      capturedAt: input.capturedAt,
      screenshotPresent: input.screenshot !== undefined,
      ...(input.thumbnailPng === undefined ? {} : { thumbnailPng: input.thumbnailPng }),
      warnings: input.warnings,
    },
  ])[0];
  if (projection === undefined) throw new Error("BundleRegistered did not produce a Projection.");

  const [bundleEnvelopeBytes, eventEnvelopeBytes, projectionEnvelopeBytes] = await Promise.all([
    encryptedBytes(
      input,
      "vault:bundle:v1",
      input.bundleId,
      "Bundle",
      input.bundleObjectId,
      built.bytes,
    ),
    encryptedBytes(input, "vault:event:v1", input.eventId, "Event", input.eventId, eventPlaintext),
    encryptedBytes(
      input,
      "vault:projection:v1",
      `LibraryItem-v1:${input.bundleId}`,
      "Projection",
      input.bundleId,
      encodeCanonicalCbor(projection),
    ),
  ]);

  return {
    object: {
      version: 1,
      objectId: input.bundleObjectId,
      objectType: "Bundle",
      envelopeBytes: bundleEnvelopeBytes,
    },
    event: {
      version: 1,
      eventId: input.eventId,
      objectId: input.bundleObjectId,
      orderingTimestamp: input.capturedAt,
      envelopeBytes: eventEnvelopeBytes,
    },
    projection: {
      version: 1,
      bundleId: input.bundleId,
      envelopeBytes: projectionEnvelopeBytes,
    },
    outcome: {
      version: 1,
      commandId: input.commandId,
      status: "Succeeded",
      bundleId: input.bundleId,
      bundleObjectId: input.bundleObjectId,
      eventId: input.eventId,
    },
  };
}
