import { wipe } from "../../crypto/sodium";
import type {
  StoredAccountMetadataV1,
  StoredAccountVaultV1,
  SynchronizationJobV1,
} from "../../drivers/indexeddb/schema";
import { createAccountVaultSlot } from "../account/crypto";
import { bytesToBase64Url } from "../account/wire";
import type { VaultRecordsV1 } from "../vault/contracts";
import { unwrapDeviceSlot, verifyRootKey } from "../vault/slots";

interface EnrollmentAccountStore {
  loadMetadata(): Promise<StoredAccountMetadataV1 | undefined>;
  loadAccountEncryptionKey(): Promise<Uint8Array>;
  beginEnrollment(input: {
    readonly registration: StoredAccountVaultV1;
    readonly job: SynchronizationJobV1;
  }): Promise<void>;
}

interface EnrollmentVaultStore {
  load(vaultId: string): Promise<VaultRecordsV1 | undefined>;
}

export async function createAccountVaultRegistration(input: {
  readonly metadata: StoredAccountMetadataV1;
  readonly records: VaultRecordsV1;
  readonly accountEncryptionKey: Uint8Array;
  readonly deliveryCursor?: number;
}): Promise<StoredAccountVaultV1> {
  let rawRootKey: Uint8Array | undefined;
  try {
    rawRootKey = await unwrapDeviceSlot(input.records.deviceSlot, input.records.deviceKey);
    const rootKey = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(rawRootKey),
      "HKDF",
      false,
      ["deriveBits"],
    );
    await verifyRootKey(rootKey, input.records.deviceSlot, input.records.metadata.verifier);
    const slot = await createAccountVaultSlot({
      vaultId: input.records.metadata.vaultId,
      accountKeyId: input.metadata.accountKeyId,
      accountEncryptionKey: input.accountEncryptionKey,
      vaultRootKey: rawRootKey,
    });
    return {
      version: 1,
      accountId: input.metadata.accountId,
      vaultId: input.records.metadata.vaultId,
      accountKeyId: input.metadata.accountKeyId,
      accountSlot: {
        ...slot,
        nonce: bytesToBase64Url(slot.nonce),
        ciphertext: bytesToBase64Url(slot.ciphertext),
      },
      remoteGenerationId: input.records.head.generationId,
      remoteGenerationNumber: input.records.head.generationNumber,
      deliveryCursor: input.deliveryCursor ?? 0,
    };
  } finally {
    if (rawRootKey !== undefined) await wipe(rawRootKey);
  }
}

export class EnrollmentService {
  constructor(
    private readonly accounts: EnrollmentAccountStore,
    private readonly vaults: EnrollmentVaultStore,
  ) {}

  async prepare(vaultId: string, now = new Date().toISOString()): Promise<SynchronizationJobV1> {
    const [metadata, records, accountEncryptionKey] = await Promise.all([
      this.accounts.loadMetadata(),
      this.vaults.load(vaultId),
      this.accounts.loadAccountEncryptionKey(),
    ]);
    if (metadata === undefined || records === undefined)
      throw Object.assign(new Error("Enrollment context is incomplete"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    try {
      const registration = await createAccountVaultRegistration({
        metadata,
        records,
        accountEncryptionKey,
      });
      const job: SynchronizationJobV1 = {
        version: 1,
        jobId: crypto.randomUUID(),
        accountId: metadata.accountId,
        vaultId,
        generationId: records.head.generationId,
        generationNumber: records.head.generationNumber,
        state: "Created",
        stage: "EnrollVault",
        createdAt: now,
        updatedAt: now,
        snapshotCursor: 0,
        completedItems: 0,
        totalItems:
          records.head.appendedObjectIds.length + records.head.appendedEventIds.length + 1,
        processedBytes: 0,
        totalBytes: 0,
        retryCount: 0,
        attachIdempotencyKey: crypto.randomUUID(),
      };
      await this.accounts.beginEnrollment({ registration, job });
      return job;
    } finally {
      await wipe(accountEncryptionKey);
    }
  }
}
