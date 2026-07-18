import { decodeCanonicalCbor, encodeCanonicalCbor } from "./cbor";
import type {
  ArtifactKind,
  ArtifactReferenceV1,
  ArtifactRole,
  BundleManifestV1,
} from "./contracts";
import { decodeBundleManifest } from "./decode-manifest";
import { DomainValidationError } from "./errors";
import { bytesEqual, sha256 } from "./hash";
import { record } from "./validation";
import { createDeterministicZip, readZipEntries } from "./zip";

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

export interface CaptureMetadataV1 {
  readonly version: 1;
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly capturedAt: string;
  readonly contentType: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly document: {
    readonly width: number;
    readonly height: number;
  };
  readonly chromeVersion: string;
  readonly extensionVersion: string;
  readonly captureProfileId: "ChromeWebPage-v1";
  readonly captureProfileVersion: 1;
}

export interface BuildBundleInput {
  readonly bundleId: string;
  readonly createdAt: string;
  readonly clientVersion: string;
  readonly metadata: CaptureMetadataV1;
  readonly mhtml: Uint8Array;
  readonly screenshot?: Uint8Array;
}

export interface BuiltBundle {
  readonly bytes: Uint8Array;
  readonly manifest: BundleManifestV1;
}

export interface ReadBundle {
  readonly manifest: BundleManifestV1;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly artifacts: ReadonlyMap<ArtifactRole, Uint8Array>;
}

interface ArtifactInput {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly role: ArtifactRole;
  readonly mimeType: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

async function artifactReference(input: ArtifactInput): Promise<ArtifactReferenceV1> {
  return {
    artifactId: input.artifactId,
    artifactVersion: 1,
    kind: input.kind,
    role: input.role,
    mimeType: input.mimeType,
    byteLength: input.bytes.byteLength,
    checksumAlgorithm: "hash:sha256:v1",
    checksum: await sha256(input.bytes),
    path: input.path,
  };
}

function manifestWireValue(manifest: BundleManifestV1): Readonly<Record<string, unknown>> {
  return {
    ...manifest.unknownFields,
    manifestVersion: manifest.manifestVersion,
    bundleVersion: manifest.bundleVersion,
    artifactSchemaVersion: manifest.artifactSchemaVersion,
    bundleId: manifest.bundleId,
    createdAt: manifest.createdAt,
    clientVersion: manifest.clientVersion,
    captureProfileId: manifest.captureProfileId,
    captureAdapterVersion: manifest.captureAdapterVersion,
    bundleSerialization: manifest.bundleSerialization,
    manifestSerialization: manifest.manifestSerialization,
    artifacts: manifest.artifacts,
  };
}

function requiredEntry(entries: Readonly<Record<string, Uint8Array>>, path: string): Uint8Array {
  const entry = entries[path];
  if (entry === undefined) {
    throw new DomainValidationError("bundle", `is missing ${path}`);
  }
  return entry;
}

function assertCanonical(bytes: Uint8Array, decoded: unknown, field: string): void {
  if (!bytesEqual(bytes, encodeCanonicalCbor(decoded))) {
    throw new DomainValidationError(field, "must use canonical CBOR");
  }
}

function assertArtifactContract(artifact: ArtifactReferenceV1): void {
  const validPrimary =
    artifact.role === "PRIMARY" &&
    artifact.kind === "CAPTURE" &&
    artifact.mimeType === "multipart/related" &&
    artifact.path === "artifacts/primary.mhtml";
  const validScreenshot =
    artifact.role === "SCREENSHOT_FULL" &&
    artifact.kind === "IMAGE" &&
    artifact.mimeType === "image/webp" &&
    artifact.path === "artifacts/screenshot-full.webp";
  if (!validPrimary && !validScreenshot) {
    throw new DomainValidationError("manifest.artifacts", "violates the Capture Profile");
  }
}

export async function buildBundle(input: BuildBundleInput): Promise<BuiltBundle> {
  if (input.mhtml.byteLength === 0) {
    throw new DomainValidationError("bundle.mhtml", "must not be empty");
  }
  const artifactInputs: ArtifactInput[] = [
    {
      artifactId: "A000001",
      kind: "CAPTURE",
      role: "PRIMARY",
      mimeType: "multipart/related",
      path: "artifacts/primary.mhtml",
      bytes: input.mhtml,
    },
  ];
  if (input.screenshot !== undefined) {
    artifactInputs.push({
      artifactId: "A000002",
      kind: "IMAGE",
      role: "SCREENSHOT_FULL",
      mimeType: "image/webp",
      path: "artifacts/screenshot-full.webp",
      bytes: input.screenshot,
    });
  }

  const manifest: BundleManifestV1 = {
    manifestVersion: 1,
    bundleVersion: 1,
    artifactSchemaVersion: 1,
    bundleId: input.bundleId,
    createdAt: input.createdAt,
    clientVersion: input.clientVersion,
    captureProfileId: "ChromeWebPage-v1",
    captureAdapterVersion: 1,
    bundleSerialization: "bundle:zip:v1",
    manifestSerialization: "cbor:canonical:v1",
    artifacts: await Promise.all(artifactInputs.map(artifactReference)),
    unknownFields: {},
  };
  decodeBundleManifest(manifestWireValue(manifest));

  const entries: Record<string, Uint8Array> = {
    "manifest.cbor": encodeCanonicalCbor(manifestWireValue(manifest)),
    "metadata.cbor": encodeCanonicalCbor(input.metadata),
  };
  for (const artifact of artifactInputs) {
    entries[artifact.path] = artifact.bytes;
  }
  const bytes = createDeterministicZip(entries);
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new DomainValidationError("bundle", "exceeds the 100 MiB limit");
  }
  return { bytes, manifest };
}

export async function readBundle(bytes: Uint8Array): Promise<ReadBundle> {
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new DomainValidationError("bundle", "exceeds the 100 MiB limit");
  }
  const entries = readZipEntries(bytes);
  const manifestBytes = requiredEntry(entries, "manifest.cbor");
  const metadataBytes = requiredEntry(entries, "metadata.cbor");
  const manifestValue = decodeCanonicalCbor(manifestBytes);
  const metadataValue = decodeCanonicalCbor(metadataBytes);
  assertCanonical(manifestBytes, manifestValue, "manifest");
  assertCanonical(metadataBytes, metadataValue, "metadata");
  const manifest = decodeBundleManifest(manifestValue);
  const metadata = record(metadataValue, "metadata");

  const artifacts = new Map<ArtifactRole, Uint8Array>();
  const expectedPaths = new Set(["manifest.cbor", "metadata.cbor"]);
  for (const artifact of manifest.artifacts) {
    assertArtifactContract(artifact);
    const artifactBytes = requiredEntry(entries, artifact.path);
    expectedPaths.add(artifact.path);
    if (artifactBytes.byteLength !== artifact.byteLength) {
      throw new DomainValidationError(artifact.path, "byte length does not match the Manifest");
    }
    if (!bytesEqual(await sha256(artifactBytes), artifact.checksum)) {
      throw new DomainValidationError(artifact.path, "checksum does not match the Manifest");
    }
    if (artifacts.has(artifact.role)) {
      throw new DomainValidationError("manifest.artifacts", "contains duplicate Roles");
    }
    artifacts.set(artifact.role, artifactBytes);
  }
  if (!artifacts.has("PRIMARY")) {
    throw new DomainValidationError("manifest.artifacts", "must contain PRIMARY");
  }
  if (Object.keys(entries).some((path) => !expectedPaths.has(path))) {
    throw new DomainValidationError("bundle", "contains an unreferenced entry");
  }
  return { manifest, metadata, artifacts };
}
