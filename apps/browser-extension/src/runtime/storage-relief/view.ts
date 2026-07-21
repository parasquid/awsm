import type { StorageReliefJobView } from "../../app/storage-relief-protocol";
import type { StorageReliefJobV1 } from "../../drivers/indexeddb/storage-relief-schema";

export function storageReliefJobView(job: StorageReliefJobV1): StorageReliefJobView {
  return {
    jobId: job.jobId,
    state: job.state === "Created" ? "Running" : job.state,
    stage:
      job.stage === "Synchronize"
        ? "Synchronizing"
        : job.stage === "Preflight"
          ? "Checking server copies"
          : job.stage === "Evict"
            ? "Freeing browser storage"
            : "Finishing",
    candidateArtifacts: job.candidateArtifacts,
    candidateBytes: job.candidateBytes,
    verifiedArtifacts: job.verifiedArtifacts,
    verifiedBytes: job.verifiedBytes,
    freedArtifacts: job.evictedArtifacts,
    freedBytes: job.freedBytes,
    skippedArtifacts: job.skippedArtifacts,
    skippedBytes: job.skippedBytes,
    cancellationRequested: job.cancellationRequested,
    ...(job.errorId === undefined ? {} : { errorId: job.errorId }),
  };
}
