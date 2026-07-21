import type { SynchronizationJobV1 } from "../../drivers/indexeddb/schema";

interface DiscardJobStore {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
}

interface DiscardArtifactStore {
  remove(vaultId: string, objectId: string): Promise<void>;
}

export class InterruptedStaleDiscardReconciler {
  constructor(
    private readonly jobs: DiscardJobStore,
    private readonly artifacts: DiscardArtifactStore,
  ) {}

  async execute(now = new Date().toISOString()): Promise<boolean> {
    const job = await this.jobs.latestSynchronizationJob();
    if (
      job?.state !== "Running" ||
      (job.stage !== "PrepareServerReplacement" && job.stage !== "ActivateServerReplacement") ||
      job.vaultId === undefined
    )
      return false;
    const vaultId = job.vaultId;
    await Promise.all(
      (job.preparedArtifactObjectIds ?? []).map((objectId) =>
        this.artifacts.remove(vaultId, objectId).catch(() => undefined),
      ),
    );
    const { preparedArtifactObjectIds: _preparedArtifactObjectIds, ...retryable } = job;
    await this.jobs.saveSynchronizationJob({
      ...retryable,
      state: "Conflict",
      stage: "Checkpoint",
      updatedAt: now,
    });
    return true;
  }
}
