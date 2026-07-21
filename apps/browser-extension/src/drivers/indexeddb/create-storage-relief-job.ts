import { abortTransaction, requestValue, transactionDone } from "./database";
import {
  decodeCaptureJob,
  decodeExportJob,
  decodeImportJob,
  decodeStoredVaultHead,
} from "./decode";
import { storageError } from "./errors";
import { vaultKey, vaultKeyRange, vaultSingletonKey } from "./keys";
import { STORES, type StoredVaultHeadV1 } from "./schema";
import { decodeServerSwitchJob } from "./server-switch-repository";
import {
  decodeStorageReliefCheckpoint,
  decodeStorageReliefJob,
  decodeStoredRemoteOnlyArtifact,
} from "./storage-relief-decode";
import {
  ACTIVE_STORAGE_RELIEF_STATES,
  assertCheckpointSetMatchesJob,
  sameAvailabilitySet,
  sameVaultHead,
} from "./storage-relief-repository-guards";
import type {
  StorageReliefCheckpointV1,
  StorageReliefJobV1,
  StoredRemoteOnlyArtifactV1,
} from "./storage-relief-schema";

export interface CreateStorageReliefJobInput {
  readonly job: StorageReliefJobV1;
  readonly expectedLocalHead: StoredVaultHeadV1;
  readonly expectedAvailability: readonly StoredRemoteOnlyArtifactV1[];
  readonly candidates: readonly StorageReliefCheckpointV1[];
}

const STORES_FOR_CREATE = [
  STORES.storageReliefJobs,
  STORES.storageReliefCheckpoints,
  STORES.artifactAvailability,
  STORES.vaultHead,
  STORES.captureJobs,
  STORES.vacuumJobs,
  STORES.exportJobs,
  STORES.importJobs,
  STORES.serverSwitchJobs,
] as const;

function changedEstimate(): Error {
  return Object.assign(new Error("The storage-relief estimate changed."), {
    id: "STORAGE_RELIEF_ESTIMATE_CHANGED",
  });
}

function busy(): Error {
  return Object.assign(new Error("Vault maintenance is already in progress."), {
    id: "VAULT_BUSY",
  });
}

async function hasCompetingWork(transaction: IDBTransaction, vaultId: string): Promise<boolean> {
  const [captures, vacuumCount, exports, imports, switches] = await Promise.all([
    requestValue(transaction.objectStore(STORES.captureJobs).getAll(vaultKeyRange(vaultId))),
    requestValue(transaction.objectStore(STORES.vacuumJobs).count(vaultKeyRange(vaultId))),
    requestValue(transaction.objectStore(STORES.exportJobs).getAll(vaultKeyRange(vaultId))),
    requestValue(transaction.objectStore(STORES.importJobs).getAll()),
    requestValue(transaction.objectStore(STORES.serverSwitchJobs).getAll()),
  ]);
  return (
    vacuumCount > 0 ||
    captures
      .map(decodeCaptureJob)
      .some((job) => job.state === "Created" || job.state === "Running") ||
    exports
      .map(decodeExportJob)
      .some((job) => job.state === "Created" || job.state === "Running") ||
    imports
      .map(decodeImportJob)
      .some((job) => job.state === "Created" || job.state === "Running") ||
    switches
      .map(decodeServerSwitchJob)
      .some((job) => job.vaultId === vaultId && job.state === "Running")
  );
}

export async function createStorageReliefJob(
  database: IDBDatabase,
  input: CreateStorageReliefJobInput,
): Promise<void> {
  const job = decodeStorageReliefJob(input.job);
  const head = decodeStoredVaultHead(input.expectedLocalHead);
  const availability = input.expectedAvailability.map(decodeStoredRemoteOnlyArtifact);
  const candidates = input.candidates.map(decodeStorageReliefCheckpoint);
  if (job.state !== "Created" || job.stage !== "Synchronize" || job.vaultId !== head.vaultId)
    throw storageError(new Error("Invalid storage-relief Job creation state."));
  if (availability.some((value) => value.vaultId !== job.vaultId))
    throw storageError(new Error("Storage-relief availability is cross-Vault."));
  if (
    candidates.some(
      (value) =>
        value.vaultId !== job.vaultId || value.jobId !== job.jobId || value.state !== "Candidate",
    )
  )
    throw storageError(new Error("Storage-relief candidates do not match the Job."));
  assertCheckpointSetMatchesJob(job, candidates);

  const transaction = database.transaction(STORES_FOR_CREATE, "readwrite");
  try {
    const [storedHead, currentAvailability, existingJobs] = await Promise.all([
      requestValue(
        transaction.objectStore(STORES.vaultHead).get(vaultSingletonKey(job.vaultId, "active")),
      ),
      requestValue(
        transaction.objectStore(STORES.artifactAvailability).getAll(vaultKeyRange(job.vaultId)),
      ),
      requestValue(
        transaction.objectStore(STORES.storageReliefJobs).getAll(vaultKeyRange(job.vaultId)),
      ),
    ]);
    const decodedHead = storedHead === undefined ? undefined : decodeStoredVaultHead(storedHead);
    const decodedAvailability = currentAvailability.map(decodeStoredRemoteOnlyArtifact);
    if (
      decodedHead === undefined ||
      !sameVaultHead(head, decodedHead) ||
      !sameAvailabilitySet(availability, decodedAvailability)
    )
      throw changedEstimate();
    const priorJobs = existingJobs.map(decodeStorageReliefJob);
    if (
      priorJobs.some((value) => ACTIVE_STORAGE_RELIEF_STATES.has(value.state)) ||
      (await hasCompetingWork(transaction, job.vaultId))
    )
      throw busy();
    const jobs = transaction.objectStore(STORES.storageReliefJobs);
    const checkpoints = transaction.objectStore(STORES.storageReliefCheckpoints);
    for (const prior of priorJobs) {
      jobs.delete(vaultKey(prior.vaultId, prior.jobId));
      checkpoints.delete(
        IDBKeyRange.bound([prior.vaultId, prior.jobId], [prior.vaultId, prior.jobId, []]),
      );
    }
    jobs.add(job, vaultKey(job.vaultId, job.jobId));
    for (const candidate of candidates)
      checkpoints.add(candidate, [candidate.vaultId, candidate.jobId, candidate.artifactObjectId]);
    await transactionDone(transaction);
  } catch (error) {
    abortTransaction(transaction);
    if (error instanceof Error && "id" in error) throw error;
    throw storageError(error);
  }
}
