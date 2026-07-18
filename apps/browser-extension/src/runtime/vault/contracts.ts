export interface VaultVerifierV1 {
  readonly version: 1;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface VaultMetadataV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly manuallyLocked: boolean;
  readonly verifier: VaultVerifierV1;
}

export interface DeviceKeySlotV1 {
  readonly version: 1;
  readonly slotId: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly algorithm: "wrap:aes-kw-256:device:v1";
  readonly wrappedRootKey: Uint8Array;
}

export interface VaultRecordsV1 {
  readonly metadata: VaultMetadataV1;
  readonly deviceSlot: DeviceKeySlotV1;
  readonly deviceKey: CryptoKey;
  readonly generation: import("../../drivers/indexeddb/schema").StoredVaultGenerationV1;
  readonly head: import("../../drivers/indexeddb/schema").StoredVaultHeadV1;
}

export interface VaultRepository {
  load(vaultId: string): Promise<VaultRecordsV1 | undefined>;
  setManualLock(vaultId: string, manuallyLocked: boolean): Promise<void>;
}

export interface PrepareVaultInput {
  readonly name: string;
  readonly createdAt: string;
}

export interface PreparedVault {
  readonly records: VaultRecordsV1;
  readonly rootKey: CryptoKey;
  readonly name: string;
}
