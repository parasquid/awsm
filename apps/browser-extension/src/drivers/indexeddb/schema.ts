export const DATABASE_VERSION = 1;

export const STORES = {
  workspaceMetadata: "workspace_metadata",
  workspaceKeys: "workspace_keys",
  vaultDirectory: "vault_directory",
  vaultNameCache: "vault_name_cache",
  vaultNameProjection: "vault_name_projection",
  vaultMetadata: "vault_metadata",
  keySlots: "key_slots",
  deviceKeys: "device_keys",
  objects: "objects",
  events: "events",
  libraryProjection: "library_projection",
  collectionProjection: "collection_projection",
  captureJobs: "capture_jobs",
  commandOutcomes: "command_outcomes",
  vaultGenerations: "vault_generations",
  vaultHead: "vault_head",
  vacuumJobs: "vacuum_jobs",
  exportJobs: "export_jobs",
  importJobs: "import_jobs",
} as const;

export interface WorkspaceMetadataV1 {
  readonly version: 1;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly activeVaultId?: string;
}

export interface WorkspaceRecordsV1 {
  readonly metadata: WorkspaceMetadataV1;
  readonly nameCacheKey: CryptoKey;
}

export interface VaultDirectoryEntryV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly createdAt: string;
}

export type StoredObjectType = "BundleDescriptor" | "Artifact";

export interface StoredBundleDescriptorObjectV1 {
  readonly version: 1;
  readonly objectId: string;
  readonly objectType: "BundleDescriptor";
  readonly envelopeBytes: Uint8Array;
}

export interface StoredArtifactObjectV1 {
  readonly version: 1;
  readonly objectId: string;
  readonly objectType: "Artifact";
  readonly envelopeFormat: "artifact:xchacha20poly1305-chunked:v1";
  readonly envelopeByteLength: number;
  readonly envelopeChecksumAlgorithm: "hash:sha256:v1";
  readonly envelopeChecksum: Uint8Array;
}

export type StoredObjectV1 = StoredBundleDescriptorObjectV1 | StoredArtifactObjectV1;

export interface StoredEvent {
  readonly version: 1;
  readonly vaultId: string;
  readonly eventId: string;
  readonly referencedObjectIds: readonly string[];
  readonly orderingTimestamp: string;
  readonly envelopeBytes: Uint8Array;
}

export interface StoredProjectionV1 {
  readonly version: 1;
  readonly bundleId: string;
  readonly envelopeBytes: Uint8Array;
}

export interface StoredCollectionProjectionV1 {
  readonly version: 1;
  readonly projectionId: string;
  readonly envelopeBytes: Uint8Array;
}

export interface StoredVaultNameProjectionV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceEventId: string;
  readonly envelopeBytes: Uint8Array;
}

export interface CommandOutcomeV1 {
  readonly version: 1;
  readonly commandId: string;
  readonly status: "Succeeded";
  readonly bundleId: string;
  readonly descriptorObjectId: string;
  readonly eventId: string;
}

export interface AtomicRegistrationV1 {
  readonly objects: readonly StoredObjectV1[];
  readonly graph: {
    readonly bundleId: string;
    readonly descriptorObjectId: string;
    readonly artifactObjectIds: readonly string[];
  };
  readonly event: StoredEvent;
  readonly projection: StoredProjectionV1;
  readonly outcome: CommandOutcomeV1;
}

export interface StoreCounts {
  readonly objects: number;
  readonly events: number;
  readonly projections: number;
  readonly outcomes: number;
}

export interface StoredVaultGenerationV1 {
  readonly version: 1;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly predecessorGenerationId?: string;
  readonly envelopeBytes: Uint8Array;
}

export interface StoredVaultHeadV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly appendedObjectIds: readonly string[];
  readonly appendedEventIds: readonly string[];
}

export interface StoredVacuumJobV1 {
  readonly version: 1;
  readonly jobId: string;
  readonly sourceGenerationId: string;
  readonly stage: "Preflight" | "Analyze" | "Rewrite" | "Verify";
  readonly createdAt: string;
}

export type ExportJobState = "Created" | "Running" | "Succeeded" | "Failed" | "Cancelled";
export type ExportJobStage = "Preflight" | "Snapshot" | "Verify" | "Package" | "Download";

export interface ExportJobV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly jobId: string;
  readonly packageId: string;
  readonly state: ExportJobState;
  readonly stage: ExportJobStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedEntries: number;
  readonly totalEntries: number;
  readonly processedBytes: number;
  readonly totalBytes: number;
  readonly cancellationRequested: boolean;
  readonly errorId?: import("../../domain/contracts").RuntimeErrorId;
}

export type ImportJobState = "Created" | "Running" | "Succeeded" | "Failed" | "Cancelled";
export type ImportJobStage =
  | "Acquire"
  | "Authenticate"
  | "Validate"
  | "Prepare"
  | "Rebuild"
  | "Commit";

export interface ImportJobV1 {
  readonly version: 1;
  readonly jobId: string;
  readonly state: ImportJobState;
  readonly stage: ImportJobStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceByteLength: number;
  readonly acquiredBytes: number;
  readonly completedEntries: number;
  readonly totalEntries: number;
  readonly processedBytes: number;
  readonly totalBytes: number;
  readonly cancellationRequested: boolean;
  readonly destinationVaultId?: string;
  readonly errorId?: import("../../domain/contracts").RuntimeErrorId;
}
