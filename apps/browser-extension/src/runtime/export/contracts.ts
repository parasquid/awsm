import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../domain/cbor";
import { DomainValidationError } from "../../domain/errors";
import { bytesEqual } from "../../domain/hash";
import { bytes, canonicalRecord, integer, literal, timestamp, uuid } from "../../domain/validation";

export type ExportRecordType = "VaultGeneration" | "VaultHead" | "Event" | "Object";

export interface ExportEntryDescriptorV1 {
  readonly path: string;
  readonly recordType: ExportRecordType;
  readonly recordId: string;
  readonly byteLength: number;
  readonly checksumAlgorithm: "hash:sha256:v1";
  readonly checksum: Uint8Array;
}

export interface ExportManifestV1 {
  readonly exportFormatVersion: 1;
  readonly packageId: string;
  readonly createdAt: string;
  readonly originatingVaultId: string;
  readonly vaultFormatVersion: 1;
  readonly bundleFormatVersion: 1;
  readonly eventFormatVersion: 1;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly objectCount: number;
  readonly eventCount: number;
  readonly supportedFeatures: readonly ["full-vault", "vault-generation"];
  readonly entries: readonly ExportEntryDescriptorV1[];
  readonly contentIntegrity: {
    readonly algorithm: "hash:sha256:v1";
    readonly checksum: Uint8Array;
  };
}

export interface ExportKeyEnvelopeV1 {
  readonly exportKeyEnvelopeVersion: 1;
  readonly purpose: "VaultExport";
  readonly packageId: string;
  readonly originatingVaultId: string;
  readonly algorithm: "wrap:xchacha20poly1305:passphrase:v1";
  readonly kdf: "kdf:argon2id:v1";
  readonly operations: 3;
  readonly memoryBytes: 67108864;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly manifestChecksumAlgorithm: "hash:sha256:v1";
  readonly manifestChecksum: Uint8Array;
  readonly ciphertext: Uint8Array;
}

const MANIFEST_FIELDS = [
  "exportFormatVersion",
  "packageId",
  "createdAt",
  "originatingVaultId",
  "vaultFormatVersion",
  "bundleFormatVersion",
  "eventFormatVersion",
  "generationId",
  "generationNumber",
  "objectCount",
  "eventCount",
  "supportedFeatures",
  "entries",
  "contentIntegrity",
] as const;

function requireCanonicalBytes(bytesValue: Uint8Array, decoded: unknown, field: string): void {
  if (!bytesEqual(bytesValue, encodeCanonicalCbor(decoded))) {
    throw new DomainValidationError(field, "must use canonical CBOR");
  }
}

function decodeEntry(value: unknown, index: number): ExportEntryDescriptorV1 {
  const field = `manifest.entries[${index}]`;
  const input = canonicalRecord(value, field, [
    "path",
    "recordType",
    "recordId",
    "byteLength",
    "checksumAlgorithm",
    "checksum",
  ]);
  const recordId = uuid(input.recordId, `${field}.recordId`);
  const recordType = input.recordType;
  if (!["VaultGeneration", "VaultHead", "Event", "Object"].includes(String(recordType))) {
    throw new DomainValidationError(`${field}.recordType`, "is unsupported");
  }
  const expectedPath =
    recordType === "VaultGeneration"
      ? "generation.cbor"
      : recordType === "VaultHead"
        ? "head.cbor"
        : `${recordType === "Event" ? "events" : "objects"}/${recordId}.cbor`;
  if (input.path !== expectedPath) {
    throw new DomainValidationError(`${field}.path`, "does not match its record identity");
  }
  return {
    path: expectedPath,
    recordType: recordType as ExportRecordType,
    recordId,
    byteLength: integer(input.byteLength, `${field}.byteLength`),
    checksumAlgorithm: literal(
      input.checksumAlgorithm,
      "hash:sha256:v1",
      `${field}.checksumAlgorithm`,
    ),
    checksum: bytes(input.checksum, 32, `${field}.checksum`),
  };
}

export function decodeExportManifest(encoded: Uint8Array): ExportManifestV1 {
  const decoded = decodeCanonicalCbor(encoded);
  requireCanonicalBytes(encoded, decoded, "manifest");
  const input = canonicalRecord(decoded, "manifest", MANIFEST_FIELDS);
  if (!Array.isArray(input.supportedFeatures)) {
    throw new DomainValidationError("manifest.supportedFeatures", "must be an array");
  }
  if (
    input.supportedFeatures.length !== 2 ||
    input.supportedFeatures[0] !== "full-vault" ||
    input.supportedFeatures[1] !== "vault-generation"
  ) {
    throw new DomainValidationError("manifest.supportedFeatures", "must be canonical");
  }
  if (!Array.isArray(input.entries)) {
    throw new DomainValidationError("manifest.entries", "must be an array");
  }
  const entries = input.entries.map(decodeEntry);
  for (let index = 1; index < entries.length; index += 1) {
    if ((entries[index - 1]?.path ?? "") >= (entries[index]?.path ?? "")) {
      throw new DomainValidationError("manifest.entries", "must have unique lexical paths");
    }
  }
  const integrity = canonicalRecord(input.contentIntegrity, "manifest.contentIntegrity", [
    "algorithm",
    "checksum",
  ]);
  const objectCount = integer(input.objectCount, "manifest.objectCount");
  const eventCount = integer(input.eventCount, "manifest.eventCount");
  if (entries.filter((entry) => entry.recordType === "Object").length !== objectCount) {
    throw new DomainValidationError("manifest.objectCount", "does not match entries");
  }
  if (entries.filter((entry) => entry.recordType === "Event").length !== eventCount) {
    throw new DomainValidationError("manifest.eventCount", "does not match entries");
  }
  return {
    exportFormatVersion: literal(input.exportFormatVersion, 1, "manifest.exportFormatVersion"),
    packageId: uuid(input.packageId, "manifest.packageId"),
    createdAt: timestamp(input.createdAt, "manifest.createdAt"),
    originatingVaultId: uuid(input.originatingVaultId, "manifest.originatingVaultId"),
    vaultFormatVersion: literal(input.vaultFormatVersion, 1, "manifest.vaultFormatVersion"),
    bundleFormatVersion: literal(input.bundleFormatVersion, 1, "manifest.bundleFormatVersion"),
    eventFormatVersion: literal(input.eventFormatVersion, 1, "manifest.eventFormatVersion"),
    generationId: uuid(input.generationId, "manifest.generationId"),
    generationNumber: integer(input.generationNumber, "manifest.generationNumber"),
    objectCount,
    eventCount,
    supportedFeatures: ["full-vault", "vault-generation"],
    entries,
    contentIntegrity: {
      algorithm: literal(
        integrity.algorithm,
        "hash:sha256:v1",
        "manifest.contentIntegrity.algorithm",
      ),
      checksum: bytes(integrity.checksum, 32, "manifest.contentIntegrity.checksum"),
    },
  };
}

export function decodeExportKeyEnvelope(encoded: Uint8Array): ExportKeyEnvelopeV1 {
  const decoded = decodeCanonicalCbor(encoded);
  requireCanonicalBytes(encoded, decoded, "exportKeyEnvelope");
  const input = canonicalRecord(decoded, "exportKeyEnvelope", [
    "exportKeyEnvelopeVersion",
    "purpose",
    "packageId",
    "originatingVaultId",
    "algorithm",
    "kdf",
    "operations",
    "memoryBytes",
    "salt",
    "nonce",
    "manifestChecksumAlgorithm",
    "manifestChecksum",
    "ciphertext",
  ]);
  return {
    exportKeyEnvelopeVersion: literal(
      input.exportKeyEnvelopeVersion,
      1,
      "exportKeyEnvelope.exportKeyEnvelopeVersion",
    ),
    purpose: literal(input.purpose, "VaultExport", "exportKeyEnvelope.purpose"),
    packageId: uuid(input.packageId, "exportKeyEnvelope.packageId"),
    originatingVaultId: uuid(input.originatingVaultId, "exportKeyEnvelope.originatingVaultId"),
    algorithm: literal(
      input.algorithm,
      "wrap:xchacha20poly1305:passphrase:v1",
      "exportKeyEnvelope.algorithm",
    ),
    kdf: literal(input.kdf, "kdf:argon2id:v1", "exportKeyEnvelope.kdf"),
    operations: literal(input.operations, 3, "exportKeyEnvelope.operations"),
    memoryBytes: literal(input.memoryBytes, 67108864, "exportKeyEnvelope.memoryBytes"),
    salt: bytes(input.salt, 16, "exportKeyEnvelope.salt"),
    nonce: bytes(input.nonce, 24, "exportKeyEnvelope.nonce"),
    manifestChecksumAlgorithm: literal(
      input.manifestChecksumAlgorithm,
      "hash:sha256:v1",
      "exportKeyEnvelope.manifestChecksumAlgorithm",
    ),
    manifestChecksum: bytes(input.manifestChecksum, 32, "exportKeyEnvelope.manifestChecksum"),
    ciphertext: bytes(input.ciphertext, 48, "exportKeyEnvelope.ciphertext"),
  };
}
