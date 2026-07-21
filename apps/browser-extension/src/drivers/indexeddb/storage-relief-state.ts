import { DomainValidationError } from "../../domain/errors";
import { bytesEqual } from "../../domain/hash";
import type {
  StorageReliefCheckpointState,
  StorageReliefCheckpointV1,
} from "./storage-relief-schema";

export { assertStorageReliefJobTransition } from "./storage-relief-job-state";

export type StorageReliefAggregates = {
  readonly candidateArtifacts: number;
  readonly candidateBytes: number;
  readonly verifiedArtifacts: number;
  readonly verifiedBytes: number;
  readonly evictedArtifacts: number;
  readonly freedBytes: number;
  readonly skippedArtifacts: number;
  readonly skippedBytes: number;
};

function assertNever(value: never): never {
  throw new DomainValidationError("storageReliefCheckpoint.state", `unexpected state ${value}`);
}

function safeSum(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new DomainValidationError(field, "exceeds the safe integer range");
  }
  return result;
}

function permitsTransition(
  current: StorageReliefCheckpointState,
  next: StorageReliefCheckpointState,
): boolean {
  switch (current) {
    case "Candidate":
      return next === "Candidate" || next === "Verified" || next === "Skipped";
    case "Verified":
      return next === "Verified" || next === "Evicting";
    case "Evicting":
      return next === "Evicting" || next === "Evicted";
    case "Evicted":
      return next === "Evicted";
    case "Skipped":
      return next === "Skipped";
    default:
      return assertNever(current);
  }
}

export function assertStorageReliefCheckpointTransition(
  current: StorageReliefCheckpointV1,
  next: StorageReliefCheckpointV1,
): void {
  if (
    current.vaultId !== next.vaultId ||
    current.jobId !== next.jobId ||
    current.artifactObjectId !== next.artifactObjectId ||
    current.envelopeByteLength !== next.envelopeByteLength ||
    !bytesEqual(current.envelopeChecksum, next.envelopeChecksum) ||
    !permitsTransition(current.state, next.state)
  ) {
    throw new DomainValidationError(
      "storageReliefCheckpoint",
      "does not preserve identity or move forward",
    );
  }
}

export function aggregateStorageReliefCheckpoints(
  checkpoints: readonly StorageReliefCheckpointV1[],
): StorageReliefAggregates {
  const totals = {
    candidateArtifacts: 0,
    candidateBytes: 0,
    verifiedArtifacts: 0,
    verifiedBytes: 0,
    evictedArtifacts: 0,
    freedBytes: 0,
    skippedArtifacts: 0,
    skippedBytes: 0,
  };
  for (const checkpoint of checkpoints) {
    totals.candidateArtifacts = safeSum(
      totals.candidateArtifacts,
      1,
      "storageReliefJob.candidateArtifacts",
    );
    totals.candidateBytes = safeSum(
      totals.candidateBytes,
      checkpoint.envelopeByteLength,
      "storageReliefJob.candidateBytes",
    );
    switch (checkpoint.state) {
      case "Candidate":
        break;
      case "Verified":
      case "Evicting":
        totals.verifiedArtifacts = safeSum(
          totals.verifiedArtifacts,
          1,
          "storageReliefJob.verifiedArtifacts",
        );
        totals.verifiedBytes = safeSum(
          totals.verifiedBytes,
          checkpoint.envelopeByteLength,
          "storageReliefJob.verifiedBytes",
        );
        break;
      case "Evicted":
        totals.verifiedArtifacts = safeSum(
          totals.verifiedArtifacts,
          1,
          "storageReliefJob.verifiedArtifacts",
        );
        totals.verifiedBytes = safeSum(
          totals.verifiedBytes,
          checkpoint.envelopeByteLength,
          "storageReliefJob.verifiedBytes",
        );
        totals.evictedArtifacts = safeSum(
          totals.evictedArtifacts,
          1,
          "storageReliefJob.evictedArtifacts",
        );
        totals.freedBytes = safeSum(
          totals.freedBytes,
          checkpoint.envelopeByteLength,
          "storageReliefJob.freedBytes",
        );
        break;
      case "Skipped":
        totals.skippedArtifacts = safeSum(
          totals.skippedArtifacts,
          1,
          "storageReliefJob.skippedArtifacts",
        );
        totals.skippedBytes = safeSum(
          totals.skippedBytes,
          checkpoint.envelopeByteLength,
          "storageReliefJob.skippedBytes",
        );
        break;
      default:
        assertNever(checkpoint.state);
    }
  }
  return totals;
}
