import type {
  ArtifactKind,
  ArtifactReferenceV1,
  ArtifactRole,
  BundleManifestV1,
} from "./contracts";
import { DomainValidationError } from "./errors";
import { artifactId, bytes, integer, literal, record, string, timestamp, uuid } from "./validation";

const MANIFEST_KEYS = new Set([
  "manifestVersion",
  "bundleVersion",
  "artifactSchemaVersion",
  "bundleId",
  "createdAt",
  "clientVersion",
  "captureProfileId",
  "captureAdapterVersion",
  "bundleSerialization",
  "manifestSerialization",
  "artifacts",
]);

function artifactKind(value: unknown, field: string): ArtifactKind {
  if (value === "CAPTURE" || value === "IMAGE") {
    return value;
  }
  throw new DomainValidationError(field, "contains an unsupported Artifact Kind");
}

function artifactRole(value: unknown, field: string): ArtifactRole {
  if (value === "PRIMARY" || value === "SCREENSHOT_FULL") {
    return value;
  }
  throw new DomainValidationError(field, "contains an unsupported Artifact Role");
}

function decodeArtifact(value: unknown, index: number): ArtifactReferenceV1 {
  const field = `manifest.artifacts[${index}]`;
  const input = record(value, field);
  const byteLength = integer(input.byteLength, `${field}.byteLength`);
  return {
    artifactId: artifactId(input.artifactId, `${field}.artifactId`),
    artifactVersion: literal(input.artifactVersion, 1, `${field}.artifactVersion`),
    kind: artifactKind(input.kind, `${field}.kind`),
    role: artifactRole(input.role, `${field}.role`),
    mimeType: string(input.mimeType, `${field}.mimeType`),
    byteLength,
    checksumAlgorithm: literal(
      input.checksumAlgorithm,
      "hash:sha256:v1",
      `${field}.checksumAlgorithm`,
    ),
    checksum: bytes(input.checksum, 32, `${field}.checksum`),
    path: string(input.path, `${field}.path`),
  };
}

export function decodeBundleManifest(value: unknown): BundleManifestV1 {
  const input = record(value, "manifest");
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new DomainValidationError("manifest.artifacts", "must be a non-empty array");
  }
  const artifacts = input.artifacts.map(decodeArtifact);
  const ids = new Set(artifacts.map((artifact) => artifact.artifactId));
  if (ids.size !== artifacts.length) {
    throw new DomainValidationError("manifest.artifacts", "contains duplicate identifiers");
  }

  for (const key of Object.keys(input)) {
    if (!MANIFEST_KEYS.has(key)) {
      throw new DomainValidationError(`manifest.${key}`, "is not part of the canonical Manifest");
    }
  }

  return {
    manifestVersion: literal(input.manifestVersion, 1, "manifest.manifestVersion"),
    bundleVersion: literal(input.bundleVersion, 1, "manifest.bundleVersion"),
    artifactSchemaVersion: literal(
      input.artifactSchemaVersion,
      1,
      "manifest.artifactSchemaVersion",
    ),
    bundleId: uuid(input.bundleId, "manifest.bundleId"),
    createdAt: timestamp(input.createdAt, "manifest.createdAt"),
    clientVersion: string(input.clientVersion, "manifest.clientVersion"),
    captureProfileId: literal(
      input.captureProfileId,
      "ChromeWebPage-v1",
      "manifest.captureProfileId",
    ),
    captureAdapterVersion: literal(
      input.captureAdapterVersion,
      1,
      "manifest.captureAdapterVersion",
    ),
    bundleSerialization: literal(
      input.bundleSerialization,
      "bundle:zip:v1",
      "manifest.bundleSerialization",
    ),
    manifestSerialization: literal(
      input.manifestSerialization,
      "cbor:canonical:v1",
      "manifest.manifestSerialization",
    ),
    artifacts,
  };
}
