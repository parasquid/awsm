import {
  CAPTURE_WARNINGS,
  type CaptureJobStage,
  type CaptureJobState,
  type CaptureJobV1,
  type CaptureWarningId,
  type EncryptedEnvelopeV1,
  type LibraryItemV1,
  RUNTIME_ERROR_IDS,
  type RuntimeErrorId,
  type RuntimeErrorV1,
} from "./contracts";
import { DomainValidationError } from "./errors";
import {
  boolean,
  bytes,
  httpUrl,
  integer,
  literal,
  record,
  string,
  timestamp,
  uuid,
} from "./validation";

function runtimeErrorId(value: unknown, field: string): RuntimeErrorId {
  for (const candidate of RUNTIME_ERROR_IDS) {
    if (value === candidate) {
      return candidate;
    }
  }
  throw new DomainValidationError(field, "contains an unsupported error identifier");
}

function warningId(value: unknown, field: string): CaptureWarningId {
  for (const candidate of CAPTURE_WARNINGS) {
    if (value === candidate) {
      return candidate;
    }
  }
  throw new DomainValidationError(field, "contains an unsupported warning identifier");
}

function jobState(value: unknown): CaptureJobState {
  if (value === "Created" || value === "Running" || value === "Succeeded" || value === "Failed") {
    return value;
  }
  throw new DomainValidationError("job.state", "contains an unsupported state");
}

function jobStage(value: unknown): CaptureJobStage {
  if (value === "Preflight" || value === "MHTML" || value === "Screenshot" || value === "Commit") {
    return value;
  }
  throw new DomainValidationError("job.stage", "contains an unsupported stage");
}

function envelopeType(value: unknown): EncryptedEnvelopeV1["objectType"] {
  if (
    value === "Bundle" ||
    value === "Event" ||
    value === "Projection" ||
    value === "WrappedKey" ||
    value === "VaultGeneration"
  ) {
    return value;
  }
  throw new DomainValidationError("envelope.objectType", "contains an unsupported Object type");
}

export function decodeEncryptedEnvelope(value: unknown): EncryptedEnvelopeV1 {
  const input = record(value, "envelope");
  const payloadLength = integer(input.payloadLength, "envelope.payloadLength");
  const ciphertext = bytes(input.ciphertext, undefined, "envelope.ciphertext");
  if (ciphertext.byteLength !== payloadLength + 16) {
    throw new DomainValidationError(
      "envelope.ciphertext",
      "must contain the payload and authentication tag",
    );
  }
  return {
    formatVersion: literal(input.formatVersion, 1, "envelope.formatVersion"),
    objectType: envelopeType(input.objectType),
    algorithm: literal(input.algorithm, "enc:xchacha20poly1305:v1", "envelope.algorithm"),
    objectId: uuid(input.objectId, "envelope.objectId"),
    payloadLength,
    nonce: bytes(input.nonce, 24, "envelope.nonce"),
    ciphertext,
  };
}

export function decodeLibraryItem(value: unknown): LibraryItemV1 {
  const input = record(value, "libraryItem");
  if (!Array.isArray(input.warnings)) {
    throw new DomainValidationError("libraryItem.warnings", "must be an array");
  }
  if (input.status !== "Active" && input.status !== "Deleted") {
    throw new DomainValidationError("libraryItem.status", "must be Active or Deleted");
  }
  return {
    version: literal(input.version, 1, "libraryItem.version"),
    bundleId: uuid(input.bundleId, "libraryItem.bundleId"),
    bundleObjectId: uuid(input.bundleObjectId, "libraryItem.bundleObjectId"),
    assignedCollectionId: uuid(input.assignedCollectionId, "libraryItem.assignedCollectionId"),
    title: string(input.title, "libraryItem.title"),
    originalUrl: httpUrl(input.originalUrl, "libraryItem.originalUrl"),
    capturedAt: timestamp(input.capturedAt, "libraryItem.capturedAt"),
    screenshotPresent: boolean(input.screenshotPresent, "libraryItem.screenshotPresent"),
    status: input.status,
    warnings: input.warnings.map((warning, index) =>
      warningId(warning, `libraryItem.warnings[${index}]`),
    ),
  };
}

export function decodeCaptureJob(value: unknown): CaptureJobV1 {
  const input = record(value, "job");
  const errorId =
    input.errorId === undefined ? undefined : runtimeErrorId(input.errorId, "job.errorId");
  return {
    version: literal(input.version, 1, "job.version"),
    jobId: uuid(input.jobId, "job.jobId"),
    commandId: uuid(input.commandId, "job.commandId"),
    tabId: integer(input.tabId, "job.tabId"),
    state: jobState(input.state),
    stage: jobStage(input.stage),
    createdAt: timestamp(input.createdAt, "job.createdAt"),
    updatedAt: timestamp(input.updatedAt, "job.updatedAt"),
    ...(errorId === undefined ? {} : { errorId }),
  };
}

export function decodeRuntimeError(value: unknown): RuntimeErrorV1 {
  const input = record(value, "error");
  return {
    id: runtimeErrorId(input.id, "error.id"),
    message: string(input.message, "error.message"),
  };
}
