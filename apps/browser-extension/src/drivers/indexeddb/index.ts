export { IndexedDbDriver } from "./driver";
export {
  StorageDriverError,
  type StorageDriverErrorId,
  storageError,
} from "./errors";
export { vaultKey, vaultKeyRange, vaultPrefixBounds, vaultSingletonKey } from "./keys";
export type {
  AtomicRegistrationV1,
  CommandOutcomeV1,
  StoreCounts,
  StoredArtifactObjectV1,
  StoredBundleDescriptorObjectV1,
  StoredCollectionProjectionV1,
  StoredEvent,
  StoredObjectType,
  StoredObjectV1,
  StoredProjectionV1,
  StoredVaultGenerationV1,
  StoredVaultHeadV1,
  StoredVaultNameProjectionV1,
  VaultDirectoryEntryV1,
  WorkspaceMetadataV1,
  WorkspaceRecordsV1,
} from "./schema";
export { IndexedDbVaultRepository } from "./vault-repository";
export { IndexedDbWorkspaceRepository } from "./workspace-repository";
