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

export interface PassphraseKeySlotV1 {
  readonly version: 1;
  readonly slotId: string;
  readonly vaultId: string;
  readonly algorithm: "wrap:xchacha20poly1305:passphrase:v1";
  readonly kdf: "kdf:argon2id:v1";
  readonly operations: 3;
  readonly memoryBytes: number;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface VaultRecordsV1 {
  readonly metadata: VaultMetadataV1;
  readonly deviceSlot: DeviceKeySlotV1;
  readonly deviceKey: CryptoKey;
  readonly passphraseSlot?: PassphraseKeySlotV1;
  readonly generation: import("../../drivers/indexeddb/schema").StoredVaultGenerationV1;
  readonly head: import("../../drivers/indexeddb/schema").StoredVaultHeadV1;
}

export interface VaultRepository {
  create(records: VaultRecordsV1): Promise<void>;
  load(): Promise<VaultRecordsV1 | undefined>;
  setManualLock(manuallyLocked: boolean): Promise<void>;
}

export interface CreateVaultInput {
  readonly passphrase?: string;
}

export interface CreatedVault {
  readonly vaultId: string;
  readonly deviceId: string;
}
