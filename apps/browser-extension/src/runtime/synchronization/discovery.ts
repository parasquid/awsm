import { wipe } from "../../crypto/sodium";
import type {
  StoredAccountMetadataV1,
  StoredAccountVaultV1,
  SynchronizationJobV1,
} from "../../drivers/indexeddb/schema";
import {
  ACCOUNT_VAULT_SLOT_ALGORITHM,
  type AccountVaultSlotV1,
  openAccountVaultSlot,
} from "../account/crypto";
import { base64UrlToBytes } from "../account/wire";

interface DiscoveryAccountStore {
  loadMetadata(): Promise<StoredAccountMetadataV1 | undefined>;
  loadAccountEncryptionKey(): Promise<Uint8Array>;
  loadAccountVault(): Promise<StoredAccountVaultV1 | undefined>;
  saveDiscoveredVault(input: {
    readonly registration?: StoredAccountVaultV1;
    readonly job: SynchronizationJobV1;
  }): Promise<void>;
}

interface DiscoveryVaultStore {
  hasVaultCollision(vaultId: string): Promise<boolean>;
  loadLocalReplica(vaultId: string): Promise<
    | {
        readonly rootKey: Uint8Array;
        readonly generationId: string;
        readonly generationNumber: number;
      }
    | undefined
  >;
}

interface DiscoveryTransport {
  request(
    method: string,
    path: string,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

function integrity(message: string): Error {
  return Object.assign(new Error(message), { id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw integrity(`${field} is invalid`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw integrity(`${field} is invalid`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw integrity(`${field} is invalid`);
  return value;
}

export function decodeAccountVaultSlot(value: unknown): AccountVaultSlotV1 {
  const slot = object(value, "Account slot");
  if (slot.version !== 1 || slot.algorithm !== ACCOUNT_VAULT_SLOT_ALGORITHM)
    throw integrity("Account slot metadata is unsupported");
  return {
    version: 1,
    slotId: text(slot.slotId, "Account slot ID"),
    vaultId: text(slot.vaultId, "Account slot Vault ID"),
    accountKeyId: text(slot.accountKeyId, "Account slot key ID"),
    algorithm: ACCOUNT_VAULT_SLOT_ALGORITHM,
    nonce: base64UrlToBytes(text(slot.nonce, "Account slot nonce"), 24),
    ciphertext: base64UrlToBytes(text(slot.ciphertext, "Account slot ciphertext"), 48),
  };
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export class AccountVaultDiscovery {
  constructor(
    private readonly accounts: DiscoveryAccountStore,
    private readonly vaults: DiscoveryVaultStore,
    private readonly transport: DiscoveryTransport,
  ) {}

  async run(now = new Date().toISOString()): Promise<SynchronizationJobV1> {
    const metadata = await this.accounts.loadMetadata();
    if (metadata === undefined) throw integrity("Account metadata is missing");
    const response = object(
      (await this.transport.request("GET", "/api/vaults")).body,
      "Vault list",
    );
    if (!Array.isArray(response.vaults) || response.vaults.length > 1)
      throw integrity("Account Vault cardinality is invalid");
    const base = {
      version: 1 as const,
      jobId: crypto.randomUUID(),
      accountId: metadata.accountId,
      createdAt: now,
      updatedAt: now,
      completedItems: 0,
      processedBytes: 0,
      totalBytes: 0,
      retryCount: 0,
      attachIdempotencyKey: crypto.randomUUID(),
    };
    if (response.vaults.length === 0) {
      const job: SynchronizationJobV1 = {
        ...base,
        state: "Waiting",
        stage: "DiscoverAccountVault",
        snapshotCursor: 0,
        totalItems: 0,
        errorId: "ACCOUNT_VAULT_SELECTION_REQUIRED",
      };
      await this.accounts.saveDiscoveredVault({ job });
      return job;
    }

    const remote = object(response.vaults[0], "Account Vault");
    const vaultId = text(remote.vaultId, "Vault ID");
    const generationId = text(remote.generationId, "Generation ID");
    const generationNumber = integer(remote.generationNumber, "Generation number");
    const predecessorGenerationId =
      remote.predecessorGenerationId === undefined
        ? undefined
        : text(remote.predecessorGenerationId, "Predecessor Generation ID");
    const snapshotCursor = integer(remote.headCursor, "head cursor");
    if (remote.state !== "Active") throw integrity("Account Vault is not active");
    const slot = decodeAccountVaultSlot(remote.accountSlot);
    if (slot.vaultId !== vaultId || slot.accountKeyId !== metadata.accountKeyId)
      throw integrity("Account slot identity differs");
    const accountEncryptionKey = await this.accounts.loadAccountEncryptionKey();
    let remoteRootKey: Uint8Array | undefined;
    let localRootKey: Uint8Array | undefined;
    const localReplicaExists = await this.vaults.hasVaultCollision(vaultId);
    let staleReplica = false;
    try {
      remoteRootKey = await openAccountVaultSlot(slot, accountEncryptionKey);
      if (localReplicaExists) {
        const local = await this.vaults.loadLocalReplica(vaultId);
        localRootKey = local?.rootKey;
        if (localRootKey === undefined || !equal(localRootKey, remoteRootKey))
          throw integrity("The local and Account Vault Root Keys differ");
        if (local?.generationId !== generationId || local.generationNumber !== generationNumber)
          staleReplica = true;
      }
    } finally {
      await wipe(accountEncryptionKey);
      if (remoteRootKey !== undefined) await wipe(remoteRootKey);
      if (localRootKey !== undefined) await wipe(localRootKey);
    }
    const prior = await this.accounts.loadAccountVault();
    const deliveryCursor = staleReplica
      ? snapshotCursor
      : localReplicaExists &&
          prior?.vaultId === vaultId &&
          prior.remoteGenerationId === generationId &&
          prior.remoteGenerationNumber === generationNumber
        ? prior.deliveryCursor
        : localReplicaExists
          ? 0
          : snapshotCursor;
    const registration: StoredAccountVaultV1 = {
      version: 1,
      accountId: metadata.accountId,
      vaultId,
      accountKeyId: metadata.accountKeyId,
      accountSlot: remote.accountSlot,
      remoteGenerationId: generationId,
      remoteGenerationNumber: generationNumber,
      deliveryCursor,
    };
    const job: SynchronizationJobV1 = {
      ...base,
      vaultId,
      generationId,
      generationNumber,
      ...(predecessorGenerationId === undefined ? {} : { predecessorGenerationId }),
      state: staleReplica ? "Conflict" : "Running",
      stage: localReplicaExists ? "UploadObjects" : "DownloadRecords",
      snapshotCursor: deliveryCursor,
      totalItems: 0,
      ...(staleReplica ? { errorId: "SYNCHRONIZATION_CONFLICT" } : {}),
    };
    await this.accounts.saveDiscoveredVault({ registration, job });
    return job;
  }
}
