export const DATABASE_VERSION = 1;

export const STORES = {
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
} as const;

export type StoredObjectType = "Bundle" | "Event";

export interface StoredObjectV1 {
  readonly version: 1;
  readonly objectId: string;
  readonly objectType: StoredObjectType;
  readonly envelopeBytes: Uint8Array;
}

export interface StoredEventV1 {
  readonly version: 1;
  readonly eventId: string;
  readonly objectId: string;
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

export interface CommandOutcomeV1 {
  readonly version: 1;
  readonly commandId: string;
  readonly status: "Succeeded";
  readonly bundleId: string;
  readonly bundleObjectId: string;
  readonly eventId: string;
}

export interface AtomicRegistrationV1 {
  readonly object: StoredObjectV1;
  readonly event: StoredEventV1;
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
