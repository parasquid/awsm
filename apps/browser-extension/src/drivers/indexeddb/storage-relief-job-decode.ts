import type { RuntimeErrorId } from "../../domain/contracts";
import { RUNTIME_ERROR_IDS } from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import {
  boolean,
  canonicalRecord,
  httpUrl,
  integer,
  literal,
  timestamp,
  uuid,
} from "../../domain/validation";
import { decodeStoredVaultHead } from "./decode";
import type {
  StorageReliefJobStage,
  StorageReliefJobState,
  StorageReliefJobV1,
} from "./storage-relief-schema";

function jobState(value: unknown): StorageReliefJobState {
  if (
    value === "Created" ||
    value === "Running" ||
    value === "WaitingForUnlock" ||
    value === "AuthenticationRequired" ||
    value === "Succeeded" ||
    value === "Failed" ||
    value === "Cancelled"
  ) {
    return value;
  }
  throw new DomainValidationError("storageReliefJob.state", "contains an unsupported state");
}

function jobStage(value: unknown): StorageReliefJobStage {
  if (
    value === "Synchronize" ||
    value === "Preflight" ||
    value === "Evict" ||
    value === "Checkpoint"
  ) {
    return value;
  }
  throw new DomainValidationError("storageReliefJob.stage", "contains an unsupported stage");
}

function runtimeErrorId(value: unknown): RuntimeErrorId {
  for (const candidate of RUNTIME_ERROR_IDS) {
    if (value === candidate) return candidate;
  }
  throw new DomainValidationError(
    "storageReliefJob.errorId",
    "contains an unsupported error identifier",
  );
}

export function decodeStorageReliefJob(value: unknown): StorageReliefJobV1 {
  const input = canonicalRecord(value, "storageReliefJob", [
    "version",
    "vaultId",
    "jobId",
    "state",
    "stage",
    "createdAt",
    "updatedAt",
    "expectedServerOrigin",
    "expectedAccountId",
    "expectedLocalHead",
    "expectedGenerationId",
    "expectedGenerationNumber",
    "candidateArtifacts",
    "candidateBytes",
    "verifiedArtifacts",
    "verifiedBytes",
    "evictedArtifacts",
    "freedBytes",
    "skippedArtifacts",
    "skippedBytes",
    "cancellationRequested",
    "errorId",
  ]);
  const state = jobState(input.state);
  const stage = jobStage(input.stage);
  const candidateArtifacts = integer(
    input.candidateArtifacts,
    "storageReliefJob.candidateArtifacts",
  );
  const candidateBytes = integer(input.candidateBytes, "storageReliefJob.candidateBytes");
  const verifiedArtifacts = integer(input.verifiedArtifacts, "storageReliefJob.verifiedArtifacts");
  const verifiedBytes = integer(input.verifiedBytes, "storageReliefJob.verifiedBytes");
  const evictedArtifacts = integer(input.evictedArtifacts, "storageReliefJob.evictedArtifacts");
  const freedBytes = integer(input.freedBytes, "storageReliefJob.freedBytes");
  const skippedArtifacts = integer(input.skippedArtifacts, "storageReliefJob.skippedArtifacts");
  const skippedBytes = integer(input.skippedBytes, "storageReliefJob.skippedBytes");
  if (
    verifiedArtifacts > candidateArtifacts ||
    evictedArtifacts > verifiedArtifacts ||
    skippedArtifacts > candidateArtifacts ||
    verifiedArtifacts + skippedArtifacts > candidateArtifacts ||
    verifiedBytes > candidateBytes ||
    freedBytes > verifiedBytes ||
    skippedBytes > candidateBytes ||
    verifiedBytes + skippedBytes > candidateBytes
  ) {
    throw new DomainValidationError("storageReliefJob", "contains impossible aggregate counters");
  }
  const expectedLocalHead =
    input.expectedLocalHead === undefined
      ? undefined
      : decodeStoredVaultHead(input.expectedLocalHead);
  const expectedGenerationId =
    input.expectedGenerationId === undefined
      ? undefined
      : uuid(input.expectedGenerationId, "storageReliefJob.expectedGenerationId");
  const expectedGenerationNumber =
    input.expectedGenerationNumber === undefined
      ? undefined
      : integer(input.expectedGenerationNumber, "storageReliefJob.expectedGenerationNumber");
  const hasFences =
    expectedLocalHead !== undefined &&
    expectedGenerationId !== undefined &&
    expectedGenerationNumber !== undefined;
  const hasAnyFence =
    expectedLocalHead !== undefined ||
    expectedGenerationId !== undefined ||
    expectedGenerationNumber !== undefined;
  if ((stage === "Synchronize" && hasAnyFence) || (stage !== "Synchronize" && !hasFences)) {
    throw new DomainValidationError(
      "storageReliefJob",
      "has Generation fences that do not match its stage",
    );
  }
  if (
    (state === "Created" && stage !== "Synchronize") ||
    (state === "Succeeded" && stage !== "Checkpoint")
  ) {
    throw new DomainValidationError("storageReliefJob", "has an impossible state and stage");
  }
  if (
    state === "Created" &&
    (verifiedArtifacts !== 0 ||
      verifiedBytes !== 0 ||
      evictedArtifacts !== 0 ||
      freedBytes !== 0 ||
      skippedArtifacts !== 0 ||
      skippedBytes !== 0 ||
      input.cancellationRequested !== false)
  ) {
    throw new DomainValidationError("storageReliefJob", "has progress before it started");
  }
  const errorId = input.errorId === undefined ? undefined : runtimeErrorId(input.errorId);
  if ((state === "Failed" || state === "AuthenticationRequired") !== (errorId !== undefined)) {
    throw new DomainValidationError("storageReliefJob.errorId", "does not match Job state");
  }
  return {
    version: literal(input.version, 1, "storageReliefJob.version"),
    vaultId: uuid(input.vaultId, "storageReliefJob.vaultId"),
    jobId: uuid(input.jobId, "storageReliefJob.jobId"),
    state,
    stage,
    createdAt: timestamp(input.createdAt, "storageReliefJob.createdAt"),
    updatedAt: timestamp(input.updatedAt, "storageReliefJob.updatedAt"),
    expectedServerOrigin: httpUrl(
      input.expectedServerOrigin,
      "storageReliefJob.expectedServerOrigin",
    ),
    expectedAccountId: uuid(input.expectedAccountId, "storageReliefJob.expectedAccountId"),
    ...(expectedLocalHead === undefined ? {} : { expectedLocalHead }),
    ...(expectedGenerationId === undefined ? {} : { expectedGenerationId }),
    ...(expectedGenerationNumber === undefined ? {} : { expectedGenerationNumber }),
    candidateArtifacts,
    candidateBytes,
    verifiedArtifacts,
    verifiedBytes,
    evictedArtifacts,
    freedBytes,
    skippedArtifacts,
    skippedBytes,
    cancellationRequested: boolean(
      input.cancellationRequested,
      "storageReliefJob.cancellationRequested",
    ),
    ...(errorId === undefined ? {} : { errorId }),
  };
}
