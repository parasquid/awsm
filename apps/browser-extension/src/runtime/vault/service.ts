import { wipe } from "../../crypto/sodium";
import type { CreatedVault, CreateVaultInput, VaultRecordsV1, VaultRepository } from "./contracts";
import { VaultServiceError } from "./errors";
import { prepareVaultGeneration } from "./generation";
import {
  createDeviceSlot,
  createPassphraseSlot,
  createVerifier,
  unwrapDeviceSlot,
  unwrapPassphraseSlot,
  verifyRootKey,
} from "./slots";

async function importRootKey(rawRootKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", Uint8Array.from(rawRootKey), "HKDF", false, ["deriveBits"]);
}

async function importWrappableRootKey(rawRootKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(rawRootKey),
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"],
  );
}

export class VaultService {
  private rootKey: CryptoKey | undefined;
  readonly repository: VaultRepository;

  constructor(repository: VaultRepository) {
    this.repository = repository;
  }

  isUnlocked(): boolean {
    return this.rootKey !== undefined;
  }

  requireRootKey(): CryptoKey {
    if (this.rootKey === undefined) {
      throw new VaultServiceError("VAULT_LOCKED", "Unlock the Vault to continue.");
    }
    return this.rootKey;
  }

  async create(input: CreateVaultInput): Promise<CreatedVault> {
    const rawRootKey = crypto.getRandomValues(new Uint8Array(32));
    const vaultId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    try {
      const wrappableRootKey = await importWrappableRootKey(rawRootKey);
      const { slot: deviceSlot, deviceKey } = await createDeviceSlot(
        wrappableRootKey,
        vaultId,
        deviceId,
      );
      const verifier = await createVerifier(rawRootKey, deviceSlot);
      const passphraseSlot =
        input.passphrase === undefined
          ? undefined
          : await createPassphraseSlot(rawRootKey, vaultId, input.passphrase);
      const rootKey = await importRootKey(rawRootKey);
      const initialGeneration = await prepareVaultGeneration({
        rootKey,
        vaultId,
        deviceId,
        generationId: crypto.randomUUID(),
        generationNumber: 0,
        createdAt: new Date().toISOString(),
        reason: "Initial",
        retainedObjectIds: [],
        retainedEventIds: [],
      });
      const records: VaultRecordsV1 = {
        metadata: {
          version: 1,
          vaultId,
          deviceId,
          createdAt: new Date().toISOString(),
          manuallyLocked: false,
          verifier,
        },
        deviceSlot,
        deviceKey,
        ...initialGeneration,
        ...(passphraseSlot === undefined ? {} : { passphraseSlot }),
      };
      try {
        await this.repository.create(records);
      } catch {
        throw new VaultServiceError(
          "STORAGE_TRANSACTION_FAILED",
          "The Vault could not be stored atomically.",
        );
      }
      this.rootKey = rootKey;
      return { vaultId, deviceId };
    } catch (error) {
      if (error instanceof VaultServiceError) throw error;
      throw new VaultServiceError(
        "CRYPTO_AUTHENTICATION_FAILED",
        "The local Vault encryption could not be initialized.",
      );
    } finally {
      await wipe(rawRootKey);
    }
  }

  async lock(): Promise<void> {
    this.rootKey = undefined;
    await this.repository.setManualLock(true);
  }

  async autoUnlock(): Promise<boolean> {
    const records = await this.repository.load();
    if (records === undefined || records.metadata.manuallyLocked) {
      return false;
    }
    await this.unlockDeviceRecords(records);
    return true;
  }

  async unlockWithDevice(): Promise<void> {
    const records = await this.requireRecords();
    await this.unlockDeviceRecords(records);
    await this.repository.setManualLock(false);
  }

  async unlockWithPassphrase(passphrase: string): Promise<void> {
    const records = await this.requireRecords();
    if (records.passphraseSlot === undefined) {
      throw new VaultServiceError("WRONG_PASSPHRASE", "The Vault could not be unlocked.");
    }
    let rawRootKey: Uint8Array | undefined;
    try {
      rawRootKey = await unwrapPassphraseSlot(records.passphraseSlot, passphrase);
      if (rawRootKey.byteLength !== 32) {
        throw new Error("Unexpected Vault Root Key length");
      }
      const rootKey = await importRootKey(rawRootKey);
      await verifyRootKey(rootKey, records.deviceSlot, records.metadata.verifier);
      this.rootKey = rootKey;
      await this.repository.setManualLock(false);
    } catch {
      throw new VaultServiceError("WRONG_PASSPHRASE", "The Vault could not be unlocked.");
    } finally {
      if (rawRootKey !== undefined) {
        await wipe(rawRootKey);
      }
    }
  }

  private async requireRecords(): Promise<VaultRecordsV1> {
    const records = await this.repository.load();
    if (records === undefined) {
      throw new VaultServiceError("VAULT_LOCKED", "No local Vault exists.");
    }
    return records;
  }

  private async unlockDeviceRecords(records: VaultRecordsV1): Promise<void> {
    let rawRootKey: Uint8Array | undefined;
    try {
      rawRootKey = await unwrapDeviceSlot(records.deviceSlot, records.deviceKey);
      const rootKey = await importRootKey(rawRootKey);
      await verifyRootKey(rootKey, records.deviceSlot, records.metadata.verifier);
      this.rootKey = rootKey;
    } catch {
      throw new VaultServiceError(
        "CRYPTO_AUTHENTICATION_FAILED",
        "The local device slot could not be authenticated.",
      );
    } finally {
      if (rawRootKey !== undefined) {
        await wipe(rawRootKey);
      }
    }
  }
}
