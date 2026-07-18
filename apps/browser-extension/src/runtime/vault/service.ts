import { wipe } from "../../crypto/sodium";
import { createExportKeyEnvelope, type ExportKeyEnvelopeV1 } from "../export";
import type {
  PreparedVault,
  PrepareVaultInput,
  VaultRecordsV1,
  VaultRepository,
} from "./contracts";
import { VaultServiceError } from "./errors";
import { prepareVaultGeneration } from "./generation";
import { normalizeVaultName } from "./name";
import { createDeviceSlot, createVerifier, unwrapDeviceSlot, verifyRootKey } from "./slots";

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
  readonly vaultId: string | undefined;

  constructor(repository: VaultRepository, vaultId?: string) {
    this.repository = repository;
    this.vaultId = vaultId;
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

  async prepareCreate(input: PrepareVaultInput): Promise<PreparedVault> {
    const name = normalizeVaultName(input.name);
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
      const rootKey = await importRootKey(rawRootKey);
      const initialGeneration = await prepareVaultGeneration({
        rootKey,
        vaultId,
        deviceId,
        generationId: crypto.randomUUID(),
        generationNumber: 0,
        createdAt: input.createdAt,
        reason: "Initial",
        retainedObjectIds: [],
        retainedEventIds: [],
      });
      const records: VaultRecordsV1 = {
        metadata: {
          version: 1,
          vaultId,
          deviceId,
          createdAt: input.createdAt,
          manuallyLocked: false,
          verifier,
        },
        deviceSlot,
        deviceKey,
        ...initialGeneration,
      };
      return { records, rootKey, name };
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

  activatePrepared(prepared: PreparedVault): void {
    this.rootKey = prepared.rootKey;
  }

  async lock(): Promise<void> {
    const vaultId = this.requireVaultId();
    this.rootKey = undefined;
    await this.repository.setManualLock(vaultId, true);
  }

  async autoUnlock(): Promise<boolean> {
    const records = await this.repository.load(this.requireVaultId());
    if (records === undefined || records.metadata.manuallyLocked) {
      return false;
    }
    await this.unlockDeviceRecords(records);
    return true;
  }

  async unlockWithDevice(): Promise<void> {
    const records = await this.requireRecords();
    await this.unlockDeviceRecords(records);
    await this.repository.setManualLock(this.requireVaultId(), false);
  }

  async createExportKeyEnvelope(input: {
    readonly packageId: string;
    readonly manifestBytes: Uint8Array;
    readonly passphrase: string;
    readonly salt: Uint8Array;
    readonly nonce: Uint8Array;
  }): Promise<ExportKeyEnvelopeV1> {
    const records = await this.requireRecords();
    let rawRootKey: Uint8Array | undefined;
    try {
      rawRootKey = await unwrapDeviceSlot(records.deviceSlot, records.deviceKey);
      const rootKey = await importRootKey(rawRootKey);
      await verifyRootKey(rootKey, records.deviceSlot, records.metadata.verifier);
      return await createExportKeyEnvelope({
        packageId: input.packageId,
        originatingVaultId: records.metadata.vaultId,
        manifestBytes: input.manifestBytes,
        passphrase: input.passphrase,
        rootKey: rawRootKey,
        salt: input.salt,
        nonce: input.nonce,
      });
    } catch (error) {
      if (error instanceof VaultServiceError) throw error;
      throw new VaultServiceError(
        "CRYPTO_AUTHENTICATION_FAILED",
        "The local device slot could not be authenticated.",
      );
    } finally {
      if (rawRootKey !== undefined) await wipe(rawRootKey);
    }
  }

  private async requireRecords(): Promise<VaultRecordsV1> {
    const records = await this.repository.load(this.requireVaultId());
    if (records === undefined) {
      throw new VaultServiceError("VAULT_LOCKED", "The scoped Vault records are unavailable.");
    }
    return records;
  }

  releaseRootKey(): void {
    this.rootKey = undefined;
  }

  private requireVaultId(): string {
    if (this.vaultId === undefined) {
      throw new VaultServiceError("VAULT_LOCKED", "No Vault context is selected.");
    }
    return this.vaultId;
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
