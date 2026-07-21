import { abortTransaction, requestValue, transactionDone } from "./database";
import { storageError } from "./errors";
import { vaultKey } from "./keys";
import { STORES } from "./schema";
import { decodeStorageReliefCheckpoint, decodeStorageReliefJob } from "./storage-relief-decode";
import { assertStorageReliefJobTransition } from "./storage-relief-job-state";
import { assertCheckpointSetMatchesJob } from "./storage-relief-repository-guards";
import type { StorageReliefJobV1 } from "./storage-relief-schema";

function checkpointRange(vaultId: string, jobId: string): IDBKeyRange {
  return IDBKeyRange.bound([vaultId, jobId], [vaultId, jobId, []]);
}

export async function saveStorageReliefJob(
  database: IDBDatabase,
  value: StorageReliefJobV1,
): Promise<void> {
  const next = decodeStorageReliefJob(value);
  const transaction = database.transaction(
    [STORES.storageReliefJobs, STORES.storageReliefCheckpoints],
    "readwrite",
  );
  try {
    const jobs = transaction.objectStore(STORES.storageReliefJobs);
    const [currentValue, checkpointValues] = await Promise.all([
      requestValue(jobs.get(vaultKey(next.vaultId, next.jobId))),
      requestValue(
        transaction
          .objectStore(STORES.storageReliefCheckpoints)
          .getAll(checkpointRange(next.vaultId, next.jobId)),
      ),
    ]);
    if (currentValue === undefined) throw new Error("Storage-relief Job is missing.");
    const current = decodeStorageReliefJob(currentValue);
    assertStorageReliefJobTransition(current, next);
    assertCheckpointSetMatchesJob(next, checkpointValues.map(decodeStorageReliefCheckpoint));
    jobs.put(next, vaultKey(next.vaultId, next.jobId));
    await transactionDone(transaction);
  } catch (error) {
    abortTransaction(transaction);
    if (error instanceof Error) throw storageError(error);
    throw storageError(error);
  }
}
