export { IndexedDbDriver } from "./driver";
export {
  StorageDriverError,
  type StorageDriverErrorId,
  storageError,
} from "./errors";
export type {
  AtomicRegistrationV1,
  CommandOutcomeV1,
  StoreCounts,
  StoredEventV1,
  StoredObjectType,
  StoredObjectV1,
  StoredProjectionV1,
  StoredVaultGenerationV1,
  StoredVaultHeadV1,
} from "./schema";
export { IndexedDbVaultRepository } from "./vault-repository";
