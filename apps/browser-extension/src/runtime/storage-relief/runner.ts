import type { RuntimeErrorId } from "../../domain/contracts";
import type { StorageReliefJobV1 } from "../../drivers/indexeddb/storage-relief-schema";
import {
  artifactObject,
  type StorageReliefArtifactStore,
  type StorageReliefContext,
  type StorageReliefFaults,
  type StorageReliefProof,
  type StorageReliefRepository,
  type StorageReliefRuntime,
  sameHead,
  storageReliefError,
  storageReliefSkipReason,
} from "./contracts";

export type { StorageReliefProof, StorageReliefRemoteRecord } from "./contracts";

export class StorageReliefJobRunner {
  constructor(
    private readonly repository: StorageReliefRepository,
    private readonly artifacts: StorageReliefArtifactStore,
    private readonly runtime: StorageReliefRuntime,
    private readonly faults: StorageReliefFaults = {},
  ) {}

  async run(vaultId: string, now = new Date().toISOString(), signal?: AbortSignal): Promise<void> {
    let job = await this.requireJob(vaultId);
    if (job.state === "Succeeded" || job.state === "Failed" || job.state === "Cancelled") return;
    try {
      if (job.cancellationRequested) return this.finish(job, "Cancelled", now);
      let context = await this.requireContext(job);
      if (job.stage === "Synchronize") {
        await this.repository.saveStorageReliefJob({ ...job, state: "Running", updatedAt: now });
        await this.runtime.synchronize(signal);
        await this.faults.afterSynchronization?.(signal);
        signal?.throwIfAborted();
        context = await this.requireContext(job);
        const proof = await this.runtime.prove(signal);
        if (
          proof.generationId !== context.head.generationId ||
          proof.generationNumber !== context.head.generationNumber
        )
          throw storageReliefError(
            "SYNCHRONIZATION_CONFLICT",
            "Remote Generation differs from local authority.",
          );
        job = await this.requireJob(vaultId);
        await this.repository.saveStorageReliefJob({
          ...job,
          state: "Running",
          stage: "Preflight",
          expectedLocalHead: context.head,
          expectedGenerationId: proof.generationId,
          expectedGenerationNumber: proof.generationNumber,
          updatedAt: now,
        });
      }
      job = await this.requireJob(vaultId);
      if (job.cancellationRequested) return this.finish(job, "Cancelled", now);
      if (job.stage === "Preflight") {
        await this.assertFences(job);
        const proof = await this.runtime.prove(signal);
        if (
          proof.generationId !== job.expectedGenerationId ||
          proof.generationNumber !== job.expectedGenerationNumber
        )
          throw storageReliefError(
            "SYNCHRONIZATION_CONFLICT",
            "Remote Generation changed during storage relief.",
          );
        await this.preflight(vaultId, job.jobId, proof, now, signal);
        job = await this.requireJob(vaultId);
        if (job.cancellationRequested) return this.finish(job, "Cancelled", now);
        await this.repository.saveStorageReliefJob({ ...job, stage: "Evict", updatedAt: now });
      }
      job = await this.requireJob(vaultId);
      const remoteFence = await this.runtime.recheckRemoteFence(signal);
      if (
        remoteFence.generationId !== job.expectedGenerationId ||
        remoteFence.generationNumber !== job.expectedGenerationNumber
      )
        throw storageReliefError(
          "SYNCHRONIZATION_CONFLICT",
          "Remote Generation changed before eviction.",
        );
      await this.evict(vaultId, job.jobId, now, signal);
      job = await this.requireJob(vaultId);
      await this.finish(job, job.cancellationRequested ? "Cancelled" : "Succeeded", now);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (signal?.aborted && signal.reason instanceof Error)
          return this.handleFailure(vaultId, now, signal.reason);
        throw error;
      }
      await this.handleFailure(vaultId, now, error);
    }
  }

  private async preflight(
    vaultId: string,
    jobId: string,
    proof: StorageReliefProof,
    now: string,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const checkpoint of await this.repository.listStorageReliefCheckpoints(vaultId, jobId)) {
      if (checkpoint.state !== "Candidate") continue;
      if (!(await this.artifacts.has(vaultId, checkpoint.artifactObjectId)))
        throw storageReliefError(
          "BUNDLE_INVALID",
          "A storage-relief candidate wrapper is missing.",
        );
      if (!(await this.artifacts.verifyEncrypted(vaultId, artifactObject(checkpoint))))
        throw storageReliefError(
          "BUNDLE_INVALID",
          "A storage-relief candidate wrapper is corrupt.",
        );
      const reason = storageReliefSkipReason(checkpoint, proof);
      await this.repository.saveStorageReliefCheckpoint(
        reason === undefined
          ? {
              ...checkpoint,
              state: "Verified",
              remoteGenerationId: proof.generationId,
              remoteGenerationNumber: proof.generationNumber,
            }
          : { ...checkpoint, state: "Skipped", skipReason: reason },
        now,
      );
      if (reason === undefined) await this.faults.afterVerifiedCheckpoint?.(signal);
    }
  }

  private async evict(
    vaultId: string,
    jobId: string,
    now: string,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let checkpoint of await this.repository.listStorageReliefCheckpoints(vaultId, jobId)) {
      if (checkpoint.state !== "Verified" && checkpoint.state !== "Evicting") continue;
      signal?.throwIfAborted();
      const job = await this.requireJob(vaultId);
      if (job.cancellationRequested) return;
      await this.assertFences(job);
      const present = await this.artifacts.has(vaultId, checkpoint.artifactObjectId);
      if (present && !(await this.artifacts.verifyEncrypted(vaultId, artifactObject(checkpoint))))
        throw storageReliefError("BUNDLE_INVALID", "An evicting Artifact wrapper is corrupt.");
      if (checkpoint.state === "Verified") {
        checkpoint = { ...checkpoint, state: "Evicting" };
        await this.repository.saveStorageReliefCheckpoint(checkpoint, now);
        await this.faults.afterEvictingCheckpoint?.(signal);
      }
      if (present) await this.artifacts.remove(vaultId, checkpoint.artifactObjectId);
      await this.faults.afterWrapperRemoved?.(signal);
      await this.repository.markArtifactRemoteOnly({
        checkpoint: { ...checkpoint, state: "Evicted" },
        availability: {
          version: 1,
          vaultId,
          artifactObjectId: checkpoint.artifactObjectId,
          markedAt: now,
        },
        updatedAt: now,
      });
      await this.faults.afterRemoteOnlyCommit?.(signal);
    }
  }

  private async requireContext(job: StorageReliefJobV1): Promise<StorageReliefContext> {
    const context = await this.runtime.current();
    if (
      context.vaultId !== job.vaultId ||
      context.accountId !== job.expectedAccountId ||
      context.serverOrigin !== job.expectedServerOrigin
    )
      throw storageReliefError("VAULT_CONTEXT_CHANGED", "Storage-relief context changed.");
    if (!context.unlocked) throw storageReliefError("VAULT_LOCKED", "The Vault is locked.");
    if (!context.authenticated)
      throw storageReliefError(
        "STORAGE_RELIEF_AUTHENTICATION_REQUIRED",
        "Authentication is required.",
      );
    return context;
  }

  private async assertFences(job: StorageReliefJobV1): Promise<void> {
    const context = await this.requireContext(job);
    if (
      job.expectedLocalHead === undefined ||
      !sameHead(job.expectedLocalHead, context.head) ||
      job.expectedGenerationId !== context.head.generationId ||
      job.expectedGenerationNumber !== context.head.generationNumber
    )
      throw storageReliefError("VAULT_CONTEXT_CHANGED", "Storage-relief authority changed.");
  }

  private async requireJob(vaultId: string): Promise<StorageReliefJobV1> {
    const job = await this.repository.latestStorageReliefJob(vaultId);
    if (job === undefined)
      throw storageReliefError("STORAGE_TRANSACTION_FAILED", "Storage-relief Job is missing.");
    return job;
  }

  private async finish(
    job: StorageReliefJobV1,
    state: "Succeeded" | "Cancelled",
    now: string,
  ): Promise<void> {
    const { errorId: _errorId, ...stableJob } = job;
    await this.repository.saveStorageReliefJob({
      ...stableJob,
      state,
      stage: "Checkpoint",
      updatedAt: job.updatedAt > now ? job.updatedAt : now,
    });
  }

  private async handleFailure(vaultId: string, now: string, error: unknown): Promise<void> {
    const job = await this.requireJob(vaultId);
    const id =
      error instanceof Error && "id" in error ? String(error.id) : "STORAGE_TRANSACTION_FAILED";
    const authentication =
      id === "STORAGE_RELIEF_AUTHENTICATION_REQUIRED" ||
      id === "SYNCHRONIZATION_AUTHENTICATION_REQUIRED" ||
      id === "AUTHENTICATION_FAILED" ||
      id === "SESSION_EXPIRED";
    const state =
      id === "VAULT_LOCKED"
        ? "WaitingForUnlock"
        : authentication
          ? "AuthenticationRequired"
          : "Failed";
    await this.repository.saveStorageReliefJob({
      ...job,
      state,
      updatedAt: job.updatedAt > now ? job.updatedAt : now,
      ...(state === "Failed" ? { errorId: id as RuntimeErrorId } : {}),
    });
  }
}
