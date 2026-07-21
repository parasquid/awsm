import { DomainValidationError } from "../../domain/errors";
import type { StoredVaultHeadV1 } from "./schema";
import type {
  StorageReliefJobStage,
  StorageReliefJobState,
  StorageReliefJobV1,
} from "./storage-relief-schema";

const STAGES: readonly StorageReliefJobStage[] = [
  "Synchronize",
  "Preflight",
  "Evict",
  "Checkpoint",
];

const TERMINAL = new Set<StorageReliefJobState>(["Succeeded", "Failed", "Cancelled"]);

function sameHead(left: StoredVaultHeadV1, right: StoredVaultHeadV1): boolean {
  return (
    left.vaultId === right.vaultId &&
    left.generationId === right.generationId &&
    left.generationNumber === right.generationNumber &&
    left.appendedObjectIds.length === right.appendedObjectIds.length &&
    left.appendedObjectIds.every((value, index) => value === right.appendedObjectIds[index]) &&
    left.appendedEventIds.length === right.appendedEventIds.length &&
    left.appendedEventIds.every((value, index) => value === right.appendedEventIds[index])
  );
}

function permitsState(current: StorageReliefJobState, next: StorageReliefJobState): boolean {
  if (TERMINAL.has(current)) return next === current;
  if (next === "Created") return current === "Created";
  return true;
}

function sameOptionalHead(
  current: StoredVaultHeadV1 | undefined,
  next: StoredVaultHeadV1 | undefined,
): boolean {
  return current === undefined || (next !== undefined && sameHead(current, next));
}

export function assertStorageReliefJobTransition(
  current: StorageReliefJobV1,
  next: StorageReliefJobV1,
): void {
  const currentStage = STAGES.indexOf(current.stage);
  const nextStage = STAGES.indexOf(next.stage);
  if (
    current.vaultId !== next.vaultId ||
    current.jobId !== next.jobId ||
    current.createdAt !== next.createdAt ||
    current.expectedServerOrigin !== next.expectedServerOrigin ||
    current.expectedAccountId !== next.expectedAccountId ||
    current.candidateArtifacts !== next.candidateArtifacts ||
    current.candidateBytes !== next.candidateBytes ||
    next.updatedAt < current.updatedAt ||
    nextStage < currentStage ||
    !permitsState(current.state, next.state) ||
    (current.cancellationRequested && !next.cancellationRequested) ||
    !sameOptionalHead(current.expectedLocalHead, next.expectedLocalHead) ||
    (current.expectedGenerationId !== undefined &&
      current.expectedGenerationId !== next.expectedGenerationId) ||
    (current.expectedGenerationNumber !== undefined &&
      current.expectedGenerationNumber !== next.expectedGenerationNumber)
  ) {
    throw new DomainValidationError(
      "storageReliefJob",
      "does not preserve identity or move forward",
    );
  }
}
