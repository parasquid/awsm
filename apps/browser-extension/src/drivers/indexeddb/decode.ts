import type {
  CaptureJobStage,
  CaptureJobState,
  CaptureJobV1,
  RuntimeErrorId,
} from "../../domain/contracts";
import { RUNTIME_ERROR_IDS } from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import { boolean, bytes, integer, literal, record, timestamp, uuid } from "../../domain/validation";
import type {
  CommandOutcomeV1,
  StoredCollectionProjectionV1,
  StoredEventV1,
  StoredObjectType,
  StoredObjectV1,
  StoredProjectionV1,
  StoredVaultGenerationV1,
} from "./schema";

function objectType(value: unknown): StoredObjectType {
  if (value === "Bundle" || value === "Event") {
    return value;
  }
  throw new DomainValidationError("object.objectType", "contains an unsupported Object type");
}

export function decodeStoredVaultGeneration(value: unknown): StoredVaultGenerationV1 {
  const input = record(value, "vaultGeneration");
  return {
    version: literal(input.version, 1, "vaultGeneration.version"),
    generationId: uuid(input.generationId, "vaultGeneration.generationId"),
    generationNumber: integer(input.generationNumber, "vaultGeneration.generationNumber"),
    ...(input.predecessorGenerationId === undefined
      ? {}
      : {
          predecessorGenerationId: uuid(
            input.predecessorGenerationId,
            "vaultGeneration.predecessorGenerationId",
          ),
        }),
    envelopeBytes: bytes(input.envelopeBytes, undefined, "vaultGeneration.envelopeBytes"),
  };
}

export function decodeStoredObject(value: unknown): StoredObjectV1 {
  const input = record(value, "object");
  return {
    version: literal(input.version, 1, "object.version"),
    objectId: uuid(input.objectId, "object.objectId"),
    objectType: objectType(input.objectType),
    envelopeBytes: bytes(input.envelopeBytes, undefined, "object.envelopeBytes"),
  };
}

export function decodeStoredEvent(value: unknown): StoredEventV1 {
  const input = record(value, "event");
  return {
    version: literal(input.version, 1, "event.version"),
    eventId: uuid(input.eventId, "event.eventId"),
    objectId: uuid(input.objectId, "event.objectId"),
    orderingTimestamp: timestamp(input.orderingTimestamp, "event.orderingTimestamp"),
    envelopeBytes: bytes(input.envelopeBytes, undefined, "event.envelopeBytes"),
  };
}

export function decodeStoredProjection(value: unknown): StoredProjectionV1 {
  const input = record(value, "projection");
  return {
    version: literal(input.version, 1, "projection.version"),
    bundleId: uuid(input.bundleId, "projection.bundleId"),
    envelopeBytes: bytes(input.envelopeBytes, undefined, "projection.envelopeBytes"),
  };
}

export function decodeStoredCollectionProjection(value: unknown): StoredCollectionProjectionV1 {
  const input = record(value, "collectionProjection");
  return {
    version: literal(input.version, 1, "collectionProjection.version"),
    projectionId: uuid(input.projectionId, "collectionProjection.projectionId"),
    envelopeBytes: bytes(input.envelopeBytes, undefined, "collectionProjection.envelopeBytes"),
  };
}

export function decodeCommandOutcome(value: unknown): CommandOutcomeV1 {
  const input = record(value, "outcome");
  return {
    version: literal(input.version, 1, "outcome.version"),
    commandId: uuid(input.commandId, "outcome.commandId"),
    status: literal(input.status, "Succeeded", "outcome.status"),
    bundleId: uuid(input.bundleId, "outcome.bundleId"),
    bundleObjectId: uuid(input.bundleObjectId, "outcome.bundleObjectId"),
    eventId: uuid(input.eventId, "outcome.eventId"),
  };
}

function captureJobState(value: unknown): CaptureJobState {
  if (value === "Created" || value === "Running" || value === "Succeeded" || value === "Failed") {
    return value;
  }
  throw new DomainValidationError("captureJob.state", "contains an unsupported state");
}

function captureJobStage(value: unknown): CaptureJobStage {
  if (value === "Preflight" || value === "MHTML" || value === "Screenshot" || value === "Commit") {
    return value;
  }
  throw new DomainValidationError("captureJob.stage", "contains an unsupported stage");
}

function runtimeErrorId(value: unknown): RuntimeErrorId {
  if (typeof value === "string" && RUNTIME_ERROR_IDS.includes(value as RuntimeErrorId)) {
    return value as RuntimeErrorId;
  }
  throw new DomainValidationError("captureJob.errorId", "contains an unsupported error identifier");
}

export function decodeCaptureJob(value: unknown): CaptureJobV1 {
  const input = record(value, "captureJob");
  const errorId = input.errorId === undefined ? undefined : runtimeErrorId(input.errorId);
  const noticeDismissed =
    input.noticeDismissed === undefined
      ? undefined
      : boolean(input.noticeDismissed, "captureJob.noticeDismissed");
  return {
    version: literal(input.version, 1, "captureJob.version"),
    jobId: uuid(input.jobId, "captureJob.jobId"),
    commandId: uuid(input.commandId, "captureJob.commandId"),
    tabId: integer(input.tabId, "captureJob.tabId"),
    state: captureJobState(input.state),
    stage: captureJobStage(input.stage),
    createdAt: timestamp(input.createdAt, "captureJob.createdAt"),
    updatedAt: timestamp(input.updatedAt, "captureJob.updatedAt"),
    ...(errorId === undefined ? {} : { errorId }),
    ...(noticeDismissed === undefined ? {} : { noticeDismissed }),
  };
}
