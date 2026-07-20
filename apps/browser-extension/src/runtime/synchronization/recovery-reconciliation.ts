import type { SynchronizationJobV1 } from "../../drivers/indexeddb/schema";

interface RecoveryJobStore {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
}

interface RecoveryArtifactStore {
  reconcile(vaultId: string, authoritativeObjectIds: ReadonlySet<string>): Promise<void>;
}

export class InterruptedStaleRecoveryReconciler {
  constructor(
    private readonly jobs: RecoveryJobStore,
    private readonly artifacts: RecoveryArtifactStore,
  ) {}

  async execute(now = new Date().toISOString()): Promise<boolean> {
    const job = await this.jobs.latestSynchronizationJob();
    if (
      job?.state !== "Running" ||
      (job.stage !== "PrepareRecoveryFork" &&
        job.stage !== "PrepareServerReplacement" &&
        job.stage !== "ActivateRecovery")
    )
      return false;
    if (job.recoveryForkVaultId !== undefined)
      await this.artifacts.reconcile(job.recoveryForkVaultId, new Set()).catch(() => undefined);
    const { recoveryForkVaultId: _recoveryForkVaultId, ...withoutFork } = job;
    await this.jobs.saveSynchronizationJob({
      ...withoutFork,
      state: "Conflict",
      stage: "Checkpoint",
      updatedAt: now,
    });
    return true;
  }
}
