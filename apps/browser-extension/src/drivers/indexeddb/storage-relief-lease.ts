import { requestValue } from "./database";
import { vaultKeyRange } from "./keys";
import { STORES } from "./schema";
import { decodeStorageReliefJob } from "./storage-relief-decode";

export async function hasActiveStorageRelief(
  transaction: IDBTransaction,
  vaultId: string,
): Promise<boolean> {
  const values = await requestValue(
    transaction.objectStore(STORES.storageReliefJobs).getAll(vaultKeyRange(vaultId)),
  );
  return values
    .map(decodeStorageReliefJob)
    .some((job) => job.state === "Created" || job.state === "Running");
}

export async function assertNoActiveStorageRelief(
  transaction: IDBTransaction,
  vaultId: string,
): Promise<void> {
  if (await hasActiveStorageRelief(transaction, vaultId))
    throw Object.assign(new Error("Storage relief is in progress."), { id: "VAULT_BUSY" });
}
