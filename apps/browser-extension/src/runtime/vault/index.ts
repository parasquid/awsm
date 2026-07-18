export type {
  CreatedVault,
  CreateVaultInput,
  DeviceKeySlotV1,
  PassphraseKeySlotV1,
  VaultMetadataV1,
  VaultRecordsV1,
  VaultRepository,
  VaultVerifierV1,
} from "./contracts";
export { VaultServiceError, type VaultServiceErrorId } from "./errors";
export { VaultService } from "./service";
