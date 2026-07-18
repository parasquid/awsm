import type { VaultRecordsV1, VaultRepository } from "../../runtime/vault/contracts";
import { decodeVaultRecords } from "../../runtime/vault/decode";
import { deleteDatabase, openDatabase, requestValue, transactionDone } from "./database";
import { storageError } from "./errors";
import { STORES } from "./schema";

export class IndexedDbVaultRepository implements VaultRepository {
  private readonly databasePromise: Promise<IDBDatabase>;
  readonly databaseName: string;

  constructor(databaseName = "awsm-vault") {
    this.databaseName = databaseName;
    this.databasePromise = openDatabase(databaseName);
  }

  async create(records: VaultRecordsV1): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.vaultMetadata,
        STORES.keySlots,
        STORES.deviceKeys,
        STORES.vaultGenerations,
        STORES.vaultHead,
      ],
      "readwrite",
    );
    try {
      transaction.objectStore(STORES.vaultMetadata).add(records.metadata, "active");
      transaction.objectStore(STORES.keySlots).add(records.deviceSlot, "device");
      if (records.passphraseSlot !== undefined) {
        transaction.objectStore(STORES.keySlots).add(records.passphraseSlot, "passphrase");
      }
      transaction.objectStore(STORES.deviceKeys).add(records.deviceKey, "device");
      transaction
        .objectStore(STORES.vaultGenerations)
        .add(records.generation, records.generation.generationId);
      transaction.objectStore(STORES.vaultHead).add(records.head, "active");
      await transactionDone(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async load(): Promise<VaultRecordsV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.vaultMetadata,
        STORES.keySlots,
        STORES.deviceKeys,
        STORES.vaultGenerations,
        STORES.vaultHead,
      ],
      "readonly",
    );
    try {
      const metadataRequest: IDBRequest<unknown> = transaction
        .objectStore(STORES.vaultMetadata)
        .get("active");
      const deviceSlotRequest: IDBRequest<unknown> = transaction
        .objectStore(STORES.keySlots)
        .get("device");
      const passphraseSlotRequest: IDBRequest<unknown> = transaction
        .objectStore(STORES.keySlots)
        .get("passphrase");
      const deviceKeyRequest: IDBRequest<unknown> = transaction
        .objectStore(STORES.deviceKeys)
        .get("device");
      const generationsRequest: IDBRequest<unknown[]> = transaction
        .objectStore(STORES.vaultGenerations)
        .getAll();
      const headRequest: IDBRequest<unknown> = transaction
        .objectStore(STORES.vaultHead)
        .get("active");
      const [metadata, deviceSlot, passphraseSlot, deviceKey, generations, head] =
        await Promise.all([
          requestValue(metadataRequest),
          requestValue(deviceSlotRequest),
          requestValue(passphraseSlotRequest),
          requestValue(deviceKeyRequest),
          requestValue(generationsRequest),
          requestValue(headRequest),
        ]);
      await transactionDone(transaction);
      if (metadata === undefined) {
        return undefined;
      }
      return decodeVaultRecords({
        metadata,
        deviceSlot,
        passphraseSlot,
        deviceKey,
        generations,
        head,
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  async setManualLock(manuallyLocked: boolean): Promise<void> {
    const records = await this.load();
    if (records === undefined) {
      throw storageError(new Error("No active Vault"));
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultMetadata, "readwrite");
    transaction
      .objectStore(STORES.vaultMetadata)
      .put({ ...records.metadata, manuallyLocked }, "active");
    try {
      await transactionDone(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async deleteDatabase(): Promise<void> {
    await deleteDatabase(this.databaseName, await this.databasePromise);
  }
}
