import { bytesEqual } from "../../domain/hash";
import type { StoredVaultHeadV1 } from "./schema";
import type {
  StorageReliefCheckpointV1,
  StorageReliefJobV1,
  StoredRemoteOnlyArtifactV1,
} from "./storage-relief-schema";
import { aggregateStorageReliefCheckpoints } from "./storage-relief-state";

export const ACTIVE_STORAGE_RELIEF_STATES = new Set<StorageReliefJobV1["state"]>([
  "Created",
  "Running",
]);

export function sameVaultHead(left: StoredVaultHeadV1, right: StoredVaultHeadV1): boolean {
  return (
    left.version === right.version &&
    left.vaultId === right.vaultId &&
    left.generationId === right.generationId &&
    left.generationNumber === right.generationNumber &&
    left.appendedObjectIds.length === right.appendedObjectIds.length &&
    left.appendedObjectIds.every((value, index) => value === right.appendedObjectIds[index]) &&
    left.appendedEventIds.length === right.appendedEventIds.length &&
    left.appendedEventIds.every((value, index) => value === right.appendedEventIds[index])
  );
}

export function sameAvailabilitySet(
  left: readonly StoredRemoteOnlyArtifactV1[],
  right: readonly StoredRemoteOnlyArtifactV1[],
): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort((a, b) =>
    a.artifactObjectId.localeCompare(b.artifactObjectId),
  );
  const orderedRight = [...right].sort((a, b) =>
    a.artifactObjectId.localeCompare(b.artifactObjectId),
  );
  return orderedLeft.every((value, index) => {
    const candidate = orderedRight[index];
    return (
      candidate !== undefined &&
      value.version === candidate.version &&
      value.vaultId === candidate.vaultId &&
      value.artifactObjectId === candidate.artifactObjectId &&
      value.markedAt === candidate.markedAt
    );
  });
}

export function assertCheckpointSetMatchesJob(
  job: StorageReliefJobV1,
  checkpoints: readonly StorageReliefCheckpointV1[],
): void {
  const aggregate = aggregateStorageReliefCheckpoints(checkpoints);
  if (
    job.candidateArtifacts !== aggregate.candidateArtifacts ||
    job.candidateBytes !== aggregate.candidateBytes ||
    job.verifiedArtifacts !== aggregate.verifiedArtifacts ||
    job.verifiedBytes !== aggregate.verifiedBytes ||
    job.evictedArtifacts !== aggregate.evictedArtifacts ||
    job.freedBytes !== aggregate.freedBytes ||
    job.skippedArtifacts !== aggregate.skippedArtifacts ||
    job.skippedBytes !== aggregate.skippedBytes
  ) {
    throw new Error("Storage-relief Job counters do not match its checkpoints.");
  }
}

export function sameCheckpointIdentity(
  left: StorageReliefCheckpointV1,
  right: StorageReliefCheckpointV1,
): boolean {
  return (
    left.vaultId === right.vaultId &&
    left.jobId === right.jobId &&
    left.artifactObjectId === right.artifactObjectId &&
    left.envelopeByteLength === right.envelopeByteLength &&
    bytesEqual(left.envelopeChecksum, right.envelopeChecksum)
  );
}
