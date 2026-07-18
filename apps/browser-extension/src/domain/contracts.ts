export const CAPTURE_WARNINGS = [
  "SCREENSHOT_UNAVAILABLE",
  "SCREENSHOT_TOO_LARGE",
  "SCREENSHOT_CAPTURE_FAILED",
  "OPTIONAL_METADATA_UNAVAILABLE",
] as const;

export type CaptureWarningId = (typeof CAPTURE_WARNINGS)[number];

export const RUNTIME_ERROR_IDS = [
  "VAULT_LOCKED",
  "UNSUPPORTED_URL",
  "PERMISSION_DENIED",
  "MHTML_UNAVAILABLE",
  "MHTML_CAPTURE_FAILED",
  "CAPTURE_TOO_LARGE",
  "CAPTURE_INTERRUPTED",
  "BUNDLE_INVALID",
  "CRYPTO_AUTHENTICATION_FAILED",
  "UNSUPPORTED_FORMAT_VERSION",
  "STORAGE_TRANSACTION_FAILED",
  "WRONG_PASSPHRASE",
] as const;

export type RuntimeErrorId = (typeof RUNTIME_ERROR_IDS)[number];

export interface RuntimeErrorV1 {
  readonly id: RuntimeErrorId;
  readonly message: string;
}

export interface CapturePageCommandV1 {
  readonly commandId: string;
  readonly commandType: "CapturePage";
  readonly commandVersion: 1;
  readonly issuingDeviceId: string;
  readonly createdAt: string;
  readonly tabId: number;
  readonly observedUrl: string;
  readonly captureProfileId: "ChromeWebPage-v1";
  readonly idempotencyKey: string;
}

export type ArtifactKind = "CAPTURE" | "IMAGE";
export type ArtifactRole = "PRIMARY" | "SCREENSHOT_FULL";

export interface ArtifactReferenceV1 {
  readonly artifactId: string;
  readonly artifactVersion: 1;
  readonly kind: ArtifactKind;
  readonly role: ArtifactRole;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly checksumAlgorithm: "hash:sha256:v1";
  readonly checksum: Uint8Array;
  readonly path: string;
}

export interface BundleManifestV1 {
  readonly manifestVersion: 1;
  readonly bundleVersion: 1;
  readonly artifactSchemaVersion: 1;
  readonly bundleId: string;
  readonly createdAt: string;
  readonly clientVersion: string;
  readonly captureProfileId: "ChromeWebPage-v1";
  readonly captureAdapterVersion: 1;
  readonly bundleSerialization: "bundle:zip:v1";
  readonly manifestSerialization: "cbor:canonical:v1";
  readonly artifacts: readonly ArtifactReferenceV1[];
  readonly unknownFields: Readonly<Record<string, unknown>>;
}

export interface EncryptedEnvelopeV1 {
  readonly formatVersion: 1;
  readonly objectType: "Bundle" | "Event" | "Projection" | "WrappedKey" | "VaultGeneration";
  readonly algorithm: "enc:xchacha20poly1305:v1";
  readonly objectId: string;
  readonly payloadLength: number;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface LibraryItemV1 {
  readonly version: 1;
  readonly bundleId: string;
  readonly bundleObjectId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly capturedAt: string;
  readonly screenshotPresent: boolean;
  readonly status: "Active" | "Deleted";
  readonly thumbnailPng?: Uint8Array;
  readonly warnings: readonly CaptureWarningId[];
}

export type CaptureJobState = "Created" | "Running" | "Succeeded" | "Failed";
export type CaptureJobStage = "Preflight" | "MHTML" | "Screenshot" | "Commit";

export interface CaptureJobV1 {
  readonly version: 1;
  readonly jobId: string;
  readonly commandId: string;
  readonly tabId: number;
  readonly state: CaptureJobState;
  readonly stage: CaptureJobStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errorId?: RuntimeErrorId;
  readonly noticeDismissed?: boolean;
}
