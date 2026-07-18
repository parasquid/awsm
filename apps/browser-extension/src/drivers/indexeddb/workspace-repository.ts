import { DomainValidationError } from "../../domain/errors";
import {
  canonicalRecord,
  integer,
  literal,
  record,
  timestamp,
  uuid,
} from "../../domain/validation";
import type { VaultRecordsV1 } from "../../runtime/vault/contracts";
import { decodeVaultMetadata } from "../../runtime/vault/decode";
import {
  decryptWorkspaceVaultName,
  type WorkspaceVaultNameCacheV1,
} from "../../runtime/vault/workspace-name-cache";
import { createWorkspaceNameCacheKey } from "../../runtime/vault/workspace-name-key";
import { deleteDatabase, openDatabase, requestValue, transactionDone } from "./database";
import { decodeExportJob, decodeStoredVaultNameProjection } from "./decode";
import { storageError } from "./errors";
import { vaultKey, vaultKeyRange, vaultSingletonKey } from "./keys";
import {
  STORES,
  type StoredEvent,
  type StoredVaultHeadV1,
  type StoredVaultNameProjectionV1,
  type VaultDirectoryEntryV1,
  type WorkspaceMetadataV1,
  type WorkspaceRecordsV1,
} from "./schema";

export interface AtomicVaultCreateV1 {
  readonly expectedActiveVaultId?: string;
  readonly records: VaultRecordsV1;
  readonly event: StoredEvent;
  readonly projection: StoredVaultNameProjectionV1;
  readonly cache: WorkspaceVaultNameCacheV1;
}

export interface AtomicVaultSelect {
  readonly expectedActiveVaultId: string;
  readonly vaultId: string;
}

export interface AtomicVaultRename {
  readonly expectedActiveVaultId: string;
  readonly vaultId: string;
  readonly event: StoredEvent;
  readonly projection: StoredVaultNameProjectionV1;
  readonly cache: WorkspaceVaultNameCacheV1;
}

export interface ReplaceVaultNameCache {
  readonly expectedActiveVaultId: string;
  readonly vaultId: string;
  readonly cache: WorkspaceVaultNameCacheV1;
}

function decodeWorkspaceMetadata(value: unknown): WorkspaceMetadataV1 {
  const input = canonicalRecord(value, "workspaceMetadata", [
    "version",
    "workspaceId",
    "createdAt",
    "activeVaultId",
  ]);
  return {
    version: literal(input.version, 1, "workspaceMetadata.version"),
    workspaceId: uuid(input.workspaceId, "workspaceMetadata.workspaceId"),
    createdAt: timestamp(input.createdAt, "workspaceMetadata.createdAt"),
    ...(input.activeVaultId === undefined
      ? {}
      : { activeVaultId: uuid(input.activeVaultId, "workspaceMetadata.activeVaultId") }),
  };
}

function decodeNameCacheKey(value: unknown): CryptoKey {
  if (!(value instanceof CryptoKey) || value.extractable || value.algorithm.name !== "AES-GCM") {
    throw new DomainValidationError(
      "workspaceNameCacheKey",
      "must be a non-exportable AES-GCM Web Crypto key",
    );
  }
  if (!value.usages.includes("encrypt") || !value.usages.includes("decrypt")) {
    throw new DomainValidationError(
      "workspaceNameCacheKey",
      "must support encryption and decryption",
    );
  }
  return value;
}

function decodeDirectoryEntry(value: unknown): VaultDirectoryEntryV1 {
  const input = canonicalRecord(value, "vaultDirectoryEntry", ["version", "vaultId", "createdAt"]);
  return {
    version: literal(input.version, 1, "vaultDirectoryEntry.version"),
    vaultId: uuid(input.vaultId, "vaultDirectoryEntry.vaultId"),
    createdAt: timestamp(input.createdAt, "vaultDirectoryEntry.createdAt"),
  };
}

function decodeVaultHead(value: unknown): StoredVaultHeadV1 {
  const input = record(value, "vaultHead");
  const allowed = new Set([
    "version",
    "vaultId",
    "generationId",
    "generationNumber",
    "appendedObjectIds",
    "appendedEventIds",
  ]);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new DomainValidationError("vaultHead", "contains fields outside the canonical schema");
  }
  const ids = (value: unknown, field: string): readonly string[] => {
    if (!Array.isArray(value)) throw new DomainValidationError(field, "must be an array");
    const parsed = value.map((candidate, index) => uuid(candidate, `${field}[${index}]`));
    if (
      new Set(parsed).size !== parsed.length ||
      parsed.some((id, index) => id !== parsed.toSorted()[index])
    ) {
      throw new DomainValidationError(field, "must contain unique UUIDs in lexical order");
    }
    return parsed;
  };
  return {
    version: literal(input.version, 1, "vaultHead.version"),
    vaultId: uuid(input.vaultId, "vaultHead.vaultId"),
    generationId: uuid(input.generationId, "vaultHead.generationId"),
    generationNumber: integer(input.generationNumber, "vaultHead.generationNumber"),
    appendedObjectIds: ids(input.appendedObjectIds, "vaultHead.appendedObjectIds"),
    appendedEventIds: ids(input.appendedEventIds, "vaultHead.appendedEventIds"),
  };
}

function decodeNameCache(value: unknown): WorkspaceVaultNameCacheV1 {
  const input = canonicalRecord(value, "workspaceVaultNameCache", [
    "version",
    "vaultId",
    "sourceEventId",
    "nonce",
    "ciphertext",
  ]);
  if (!(input.nonce instanceof Uint8Array) || input.nonce.byteLength !== 12) {
    throw new DomainValidationError("workspaceVaultNameCache.nonce", "must be 12 bytes");
  }
  if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength < 17) {
    throw new DomainValidationError(
      "workspaceVaultNameCache.ciphertext",
      "must contain authenticated ciphertext",
    );
  }
  return {
    version: literal(input.version, 1, "workspaceVaultNameCache.version"),
    vaultId: uuid(input.vaultId, "workspaceVaultNameCache.vaultId"),
    sourceEventId: uuid(input.sourceEventId, "workspaceVaultNameCache.sourceEventId"),
    nonce: input.nonce,
    ciphertext: input.ciphertext,
  };
}

export class IndexedDbWorkspaceRepository {
  private readonly databasePromise: Promise<IDBDatabase>;
  readonly databaseName: string;

  constructor(databaseName = "awsm-vault") {
    this.databaseName = databaseName;
    this.databasePromise = openDatabase(databaseName);
  }

  async bootstrap(createdAt: string): Promise<WorkspaceRecordsV1> {
    const existing = await this.load();
    if (existing !== undefined) return existing;
    timestamp(createdAt, "workspaceMetadata.createdAt");
    const nameCacheKey = await createWorkspaceNameCacheKey();
    const metadata: WorkspaceMetadataV1 = {
      version: 1,
      workspaceId: crypto.randomUUID(),
      createdAt,
    };
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.workspaceMetadata, STORES.workspaceKeys],
      "readwrite",
    );
    try {
      transaction.objectStore(STORES.workspaceMetadata).add(metadata, "local");
      transaction.objectStore(STORES.workspaceKeys).add(nameCacheKey, "name-cache");
      await transactionDone(transaction);
      return { metadata, nameCacheKey };
    } catch (error) {
      transaction.abort();
      const raced = await this.load();
      if (raced !== undefined) return raced;
      throw storageError(error);
    }
  }

  async load(): Promise<WorkspaceRecordsV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.workspaceMetadata, STORES.workspaceKeys],
      "readonly",
    );
    try {
      const [metadataValue, keyValue] = await Promise.all([
        requestValue(transaction.objectStore(STORES.workspaceMetadata).get("local")),
        requestValue(transaction.objectStore(STORES.workspaceKeys).get("name-cache")),
      ]);
      await transactionDone(transaction);
      if (metadataValue === undefined && keyValue === undefined) return undefined;
      if (metadataValue === undefined || keyValue === undefined) {
        throw new DomainValidationError("workspace", "is only partially initialized");
      }
      return {
        metadata: decodeWorkspaceMetadata(metadataValue),
        nameCacheKey: decodeNameCacheKey(keyValue),
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  async listVaultDirectory(): Promise<readonly VaultDirectoryEntryV1[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultDirectory, "readonly");
    try {
      const values = await requestValue(transaction.objectStore(STORES.vaultDirectory).getAll());
      await transactionDone(transaction);
      return values.map(decodeDirectoryEntry);
    } catch (error) {
      throw storageError(error);
    }
  }

  async loadVaultStatus(
    vaultId: string,
  ): Promise<{ readonly manuallyLocked: boolean } | undefined> {
    uuid(vaultId, "vaultId");
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultMetadata, "readonly");
    try {
      const metadataValue = await requestValue(
        transaction.objectStore(STORES.vaultMetadata).get(vaultSingletonKey(vaultId, "metadata")),
      );
      await transactionDone(transaction);
      if (metadataValue === undefined) return undefined;
      const metadata = decodeVaultMetadata(metadataValue);
      return { manuallyLocked: metadata.manuallyLocked };
    } catch (error) {
      throw storageError(error);
    }
  }

  async readVaultName(key: CryptoKey, workspaceId: string, vaultId: string): Promise<string> {
    uuid(workspaceId, "workspaceId");
    uuid(vaultId, "vaultId");
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultNameCache, "readonly");
    try {
      const value = await requestValue(transaction.objectStore(STORES.vaultNameCache).get(vaultId));
      await transactionDone(transaction);
      if (value === undefined)
        throw new DomainValidationError("workspaceVaultNameCache", "is missing");
      const cache = decodeNameCache(value);
      if (cache.vaultId !== vaultId) {
        throw new DomainValidationError(
          "workspaceVaultNameCache.vaultId",
          "does not match its key",
        );
      }
      return await decryptWorkspaceVaultName(key, workspaceId, cache);
    } catch (error) {
      throw storageError(error);
    }
  }

  async commitVaultCreate(input: AtomicVaultCreateV1): Promise<void> {
    const vaultId = input.records.metadata.vaultId;
    if (
      input.event.vaultId !== vaultId ||
      input.projection.vaultId !== vaultId ||
      input.cache.vaultId !== vaultId ||
      input.event.eventId !== input.projection.sourceEventId ||
      input.event.eventId !== input.cache.sourceEventId
    ) {
      throw storageError(new Error("Atomic Vault creation records do not share one identity."));
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.workspaceMetadata,
        STORES.vaultDirectory,
        STORES.vaultNameCache,
        STORES.vaultNameProjection,
        STORES.vaultMetadata,
        STORES.keySlots,
        STORES.deviceKeys,
        STORES.events,
        STORES.captureJobs,
        STORES.vaultGenerations,
        STORES.vaultHead,
        STORES.vacuumJobs,
        STORES.exportJobs,
      ],
      "readwrite",
    );
    try {
      const workspaceValue = await requestValue(
        transaction.objectStore(STORES.workspaceMetadata).get("local"),
      );
      if (workspaceValue === undefined) throw new Error("Workspace is not initialized.");
      const workspace = decodeWorkspaceMetadata(workspaceValue);
      if (workspace.activeVaultId !== input.expectedActiveVaultId) {
        throw Object.assign(new Error("The active Vault changed."), {
          id: "VAULT_CONTEXT_CHANGED",
        });
      }
      const currentVaultId = workspace.activeVaultId;
      if (currentVaultId !== undefined) {
        const [captureJobs, vacuumJobs, exportJobs, previousMetadataValue] = await Promise.all([
          requestValue(
            transaction.objectStore(STORES.captureJobs).getAll(vaultKeyRange(currentVaultId)),
          ),
          requestValue(
            transaction.objectStore(STORES.vacuumJobs).getAll(vaultKeyRange(currentVaultId)),
          ),
          requestValue(
            transaction.objectStore(STORES.exportJobs).getAll(vaultKeyRange(currentVaultId)),
          ),
          requestValue(
            transaction
              .objectStore(STORES.vaultMetadata)
              .get(vaultSingletonKey(currentVaultId, "metadata")),
          ),
        ]);
        const captureBusy = captureJobs.some(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            "state" in value &&
            (value.state === "Created" || value.state === "Running"),
        );
        const exportBusy = exportJobs
          .map(decodeExportJob)
          .some((job) => job.state === "Created" || job.state === "Running");
        if (captureBusy || vacuumJobs.length > 0 || exportBusy) {
          throw Object.assign(new Error("The active Vault is busy."), { id: "VAULT_BUSY" });
        }
        if (previousMetadataValue === undefined)
          throw new Error("Active Vault metadata is missing.");
        const previousMetadata = decodeVaultMetadata(previousMetadataValue);
        transaction
          .objectStore(STORES.vaultMetadata)
          .put(
            { ...previousMetadata, manuallyLocked: true },
            vaultSingletonKey(currentVaultId, "metadata"),
          );
      }
      const records = input.records;
      transaction
        .objectStore(STORES.vaultMetadata)
        .add(records.metadata, vaultSingletonKey(vaultId, "metadata"));
      transaction
        .objectStore(STORES.keySlots)
        .add(records.deviceSlot, vaultSingletonKey(vaultId, "device"));
      transaction
        .objectStore(STORES.deviceKeys)
        .add(records.deviceKey, vaultSingletonKey(vaultId, "device"));
      transaction
        .objectStore(STORES.vaultGenerations)
        .add(records.generation, vaultKey(vaultId, records.generation.generationId));
      transaction
        .objectStore(STORES.events)
        .add(input.event, vaultKey(vaultId, input.event.eventId));
      transaction
        .objectStore(STORES.vaultNameProjection)
        .add(input.projection, vaultSingletonKey(vaultId, "active"));
      transaction.objectStore(STORES.vaultNameCache).add(input.cache, vaultId);
      transaction.objectStore(STORES.vaultDirectory).add(
        {
          version: 1,
          vaultId,
          createdAt: records.metadata.createdAt,
        } satisfies VaultDirectoryEntryV1,
        vaultId,
      );
      transaction
        .objectStore(STORES.vaultHead)
        .add(
          { ...records.head, appendedEventIds: [input.event.eventId] },
          vaultSingletonKey(vaultId, "active"),
        );
      transaction
        .objectStore(STORES.workspaceMetadata)
        .put({ ...workspace, activeVaultId: vaultId }, "local");
      await transactionDone(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {}
      throw storageError(error);
    }
  }

  async commitVaultSelect(input: AtomicVaultSelect): Promise<void> {
    uuid(input.expectedActiveVaultId, "selectActiveVault.expectedActiveVaultId");
    uuid(input.vaultId, "selectActiveVault.vaultId");
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.workspaceMetadata,
        STORES.vaultDirectory,
        STORES.vaultMetadata,
        STORES.captureJobs,
        STORES.vacuumJobs,
        STORES.exportJobs,
      ],
      "readwrite",
    );
    try {
      const workspaceValue = await requestValue(
        transaction.objectStore(STORES.workspaceMetadata).get("local"),
      );
      if (workspaceValue === undefined) throw new Error("Workspace is not initialized.");
      const workspace = decodeWorkspaceMetadata(workspaceValue);
      if (workspace.activeVaultId !== input.expectedActiveVaultId) {
        throw Object.assign(new Error("The active Vault changed."), {
          id: "VAULT_CONTEXT_CHANGED",
        });
      }
      if (input.vaultId === workspace.activeVaultId) {
        await transactionDone(transaction);
        return;
      }
      const previousVaultId = workspace.activeVaultId;
      if (previousVaultId === undefined) {
        throw Object.assign(new Error("No active Vault exists."), { id: "VAULT_NOT_FOUND" });
      }
      const [
        targetDirectory,
        targetMetadataValue,
        previousMetadataValue,
        captureJobs,
        vacuumJobs,
        exportJobs,
      ] = await Promise.all([
        requestValue(transaction.objectStore(STORES.vaultDirectory).get(input.vaultId)),
        requestValue(
          transaction
            .objectStore(STORES.vaultMetadata)
            .get(vaultSingletonKey(input.vaultId, "metadata")),
        ),
        requestValue(
          transaction
            .objectStore(STORES.vaultMetadata)
            .get(vaultSingletonKey(previousVaultId, "metadata")),
        ),
        requestValue(
          transaction.objectStore(STORES.captureJobs).getAll(vaultKeyRange(previousVaultId)),
        ),
        requestValue(
          transaction.objectStore(STORES.vacuumJobs).getAll(vaultKeyRange(previousVaultId)),
        ),
        requestValue(
          transaction.objectStore(STORES.exportJobs).getAll(vaultKeyRange(previousVaultId)),
        ),
      ]);
      if (targetDirectory === undefined || targetMetadataValue === undefined) {
        throw Object.assign(new Error("The selected Vault does not exist."), {
          id: "VAULT_NOT_FOUND",
        });
      }
      if (previousMetadataValue === undefined) throw new Error("Active Vault metadata is missing.");
      const captureBusy = captureJobs.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "state" in value &&
          (value.state === "Created" || value.state === "Running"),
      );
      const exportBusy = exportJobs
        .map(decodeExportJob)
        .some((job) => job.state === "Created" || job.state === "Running");
      if (captureBusy || vacuumJobs.length > 0 || exportBusy) {
        throw Object.assign(new Error("The active Vault is busy."), { id: "VAULT_BUSY" });
      }
      const targetMetadata = decodeVaultMetadata(targetMetadataValue);
      const previousMetadata = decodeVaultMetadata(previousMetadataValue);
      transaction
        .objectStore(STORES.vaultMetadata)
        .put(
          { ...previousMetadata, manuallyLocked: true },
          vaultSingletonKey(previousVaultId, "metadata"),
        );
      transaction
        .objectStore(STORES.vaultMetadata)
        .put(
          { ...targetMetadata, manuallyLocked: true },
          vaultSingletonKey(input.vaultId, "metadata"),
        );
      transaction
        .objectStore(STORES.workspaceMetadata)
        .put({ ...workspace, activeVaultId: input.vaultId }, "local");
      await transactionDone(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {}
      throw storageError(error);
    }
  }

  async commitVaultRename(input: AtomicVaultRename): Promise<void> {
    uuid(input.expectedActiveVaultId, "renameVault.expectedActiveVaultId");
    uuid(input.vaultId, "renameVault.vaultId");
    if (
      input.expectedActiveVaultId !== input.vaultId ||
      input.event.vaultId !== input.vaultId ||
      input.projection.vaultId !== input.vaultId ||
      input.cache.vaultId !== input.vaultId ||
      input.event.eventId !== input.projection.sourceEventId ||
      input.event.eventId !== input.cache.sourceEventId
    ) {
      throw Object.assign(new Error("Vault Rename records do not share one active identity."), {
        id: "VAULT_CONTEXT_CHANGED",
      });
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.workspaceMetadata,
        STORES.vaultMetadata,
        STORES.captureJobs,
        STORES.vacuumJobs,
        STORES.exportJobs,
        STORES.events,
        STORES.vaultNameProjection,
        STORES.vaultNameCache,
        STORES.vaultHead,
      ],
      "readwrite",
    );
    try {
      const [workspaceValue, metadataValue, captureJobs, vacuumCount, exportJobs, headValue] =
        await Promise.all([
          requestValue(transaction.objectStore(STORES.workspaceMetadata).get("local")),
          requestValue(
            transaction
              .objectStore(STORES.vaultMetadata)
              .get(vaultSingletonKey(input.vaultId, "metadata")),
          ),
          requestValue(
            transaction.objectStore(STORES.captureJobs).getAll(vaultKeyRange(input.vaultId)),
          ),
          requestValue(
            transaction.objectStore(STORES.vacuumJobs).count(vaultKeyRange(input.vaultId)),
          ),
          requestValue(
            transaction.objectStore(STORES.exportJobs).getAll(vaultKeyRange(input.vaultId)),
          ),
          requestValue(
            transaction
              .objectStore(STORES.vaultHead)
              .get(vaultSingletonKey(input.vaultId, "active")),
          ),
        ]);
      if (workspaceValue === undefined) throw new Error("Workspace is not initialized.");
      const workspace = decodeWorkspaceMetadata(workspaceValue);
      if (workspace.activeVaultId !== input.expectedActiveVaultId) {
        throw Object.assign(new Error("The active Vault changed."), {
          id: "VAULT_CONTEXT_CHANGED",
        });
      }
      if (metadataValue === undefined || headValue === undefined) {
        throw Object.assign(new Error("The active Vault does not exist."), {
          id: "VAULT_NOT_FOUND",
        });
      }
      const metadata = decodeVaultMetadata(metadataValue);
      if (metadata.manuallyLocked) {
        throw Object.assign(new Error("Unlock the Vault before renaming it."), {
          id: "VAULT_LOCKED",
        });
      }
      const captureBusy = captureJobs.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "state" in value &&
          (value.state === "Created" || value.state === "Running"),
      );
      const exportBusy = exportJobs
        .map(decodeExportJob)
        .some((job) => job.state === "Created" || job.state === "Running");
      if (captureBusy || vacuumCount !== 0 || exportBusy) {
        throw Object.assign(new Error("The active Vault is busy."), { id: "VAULT_BUSY" });
      }
      const head = decodeVaultHead(headValue);
      if (head.vaultId !== input.vaultId) throw new Error("Vault head identity mismatch.");
      transaction
        .objectStore(STORES.events)
        .add(input.event, vaultKey(input.vaultId, input.event.eventId));
      transaction
        .objectStore(STORES.vaultNameProjection)
        .put(input.projection, vaultSingletonKey(input.vaultId, "active"));
      transaction.objectStore(STORES.vaultNameCache).put(input.cache, input.vaultId);
      transaction.objectStore(STORES.vaultHead).put(
        {
          ...head,
          appendedEventIds: [...head.appendedEventIds, input.event.eventId].toSorted(),
        },
        vaultSingletonKey(input.vaultId, "active"),
      );
      await transactionDone(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {}
      throw storageError(error);
    }
  }

  async replaceVaultNameCache(input: ReplaceVaultNameCache): Promise<void> {
    uuid(input.expectedActiveVaultId, "replaceVaultNameCache.expectedActiveVaultId");
    uuid(input.vaultId, "replaceVaultNameCache.vaultId");
    if (input.expectedActiveVaultId !== input.vaultId || input.cache.vaultId !== input.vaultId) {
      throw Object.assign(new Error("The active Vault changed."), {
        id: "VAULT_CONTEXT_CHANGED",
      });
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.workspaceMetadata,
        STORES.vaultDirectory,
        STORES.vaultNameProjection,
        STORES.vaultNameCache,
      ],
      "readwrite",
    );
    try {
      const [workspaceValue, directoryValue, projectionValue] = await Promise.all([
        requestValue(transaction.objectStore(STORES.workspaceMetadata).get("local")),
        requestValue(transaction.objectStore(STORES.vaultDirectory).get(input.vaultId)),
        requestValue(
          transaction
            .objectStore(STORES.vaultNameProjection)
            .get(vaultSingletonKey(input.vaultId, "active")),
        ),
      ]);
      if (workspaceValue === undefined) throw new Error("Workspace is not initialized.");
      const workspace = decodeWorkspaceMetadata(workspaceValue);
      if (workspace.activeVaultId !== input.expectedActiveVaultId) {
        throw Object.assign(new Error("The active Vault changed."), {
          id: "VAULT_CONTEXT_CHANGED",
        });
      }
      if (directoryValue === undefined || projectionValue === undefined) {
        throw Object.assign(new Error("The active Vault name state is unavailable."), {
          id: "VAULT_NOT_FOUND",
        });
      }
      const projection = decodeStoredVaultNameProjection(projectionValue);
      if (
        projection.vaultId !== input.vaultId ||
        projection.sourceEventId !== input.cache.sourceEventId
      ) {
        throw new Error("The Vault name cache does not match its authoritative Projection.");
      }
      transaction.objectStore(STORES.vaultNameCache).put(input.cache, input.vaultId);
      await transactionDone(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {}
      throw storageError(error);
    }
  }

  async deleteDatabase(): Promise<void> {
    await deleteDatabase(this.databaseName, await this.databasePromise);
  }

  async close(): Promise<void> {
    (await this.databasePromise).close();
  }
}
