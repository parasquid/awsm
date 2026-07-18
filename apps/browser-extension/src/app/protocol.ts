import type {
  CaptureJobV1,
  CaptureWarningId,
  LibraryItemV1,
  RuntimeErrorId,
} from "../domain/contracts";

export type AppRequestV1 =
  | { readonly version: 1; readonly type: "GetState" }
  | { readonly version: 1; readonly type: "CreateVault"; readonly passphrase?: string }
  | { readonly version: 1; readonly type: "UnlockDevice" }
  | { readonly version: 1; readonly type: "UnlockPassphrase"; readonly passphrase: string }
  | { readonly version: 1; readonly type: "LockVault" }
  | { readonly version: 1; readonly type: "DismissRecentCapture"; readonly jobId: string }
  | { readonly version: 1; readonly type: "CaptureActivePage"; readonly tabId?: number }
  | { readonly version: 1; readonly type: "ListLibrary" }
  | { readonly version: 1; readonly type: "ListDeleted" }
  | { readonly version: 1; readonly type: "DeleteCaptures"; readonly bundleIds: readonly string[] }
  | { readonly version: 1; readonly type: "RestoreCaptures"; readonly bundleIds: readonly string[] }
  | {
      readonly version: 1;
      readonly type: "MergeCollections";
      readonly destinationCollectionId: string;
      readonly sourceCollectionIds: readonly string[];
    }
  | {
      readonly version: 1;
      readonly type: "MoveCaptures";
      readonly bundleIds: readonly string[];
      readonly destinationCollectionId: string;
    }
  | { readonly version: 1; readonly type: "ExtractCaptures"; readonly bundleIds: readonly string[] }
  | {
      readonly version: 1;
      readonly type: "UndoLibraryOperation";
      readonly operationEventId: string;
    }
  | { readonly version: 1; readonly type: "VacuumVault" }
  | { readonly version: 1; readonly type: "GetVacuumEstimate" }
  | { readonly version: 1; readonly type: "GetLibraryDetail"; readonly bundleId: string };

export interface AppStateV1 {
  readonly version: 1;
  readonly vaultExists: boolean;
  readonly unlocked: boolean;
  readonly hasPassphraseSlot: boolean;
  readonly latestJob?: CaptureJobV1;
  readonly latestWarnings?: readonly CaptureWarningId[];
  readonly recentCapture?: RecentCaptureV1;
}

export interface RecentCaptureV1 {
  readonly jobId: string;
  readonly bundleId: string;
  readonly title: string;
  readonly screenshotBase64?: string;
  readonly warnings: readonly CaptureWarningId[];
}

export interface LibraryDetailMessageV1 {
  readonly item: LibraryItemV1;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly mhtmlBase64: string;
  readonly screenshotBase64?: string;
}

export interface LibraryPageGroupMessageV1 {
  readonly collectionId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly knownUrls: readonly string[];
  readonly latest: LibraryItemV1;
  readonly captures: readonly LibraryItemV1[];
  readonly captureThumbnails: readonly LibraryCaptureThumbnailV1[];
}

export interface LibraryCaptureThumbnailV1 {
  readonly bundleId: string;
  readonly thumbnailBase64?: string;
}

export interface LibraryOperationReceiptV1 {
  readonly version: 1;
  readonly operationEventId: string;
  readonly destinationCollectionId: string;
}

export type AppValueV1 =
  | AppStateV1
  | readonly LibraryPageGroupMessageV1[]
  | LibraryDetailMessageV1
  | LibraryOperationReceiptV1
  | { readonly bundleId: string }
  | { readonly version: 1; readonly deletedCaptureCount: number; readonly reclaimedBytes: number }
  | { readonly version: 1; readonly deletedCaptureCount: number; readonly reclaimableBytes: number }
  | null;

export type AppResponseV1 =
  | { readonly version: 1; readonly ok: true; readonly value: AppValueV1 }
  | {
      readonly version: 1;
      readonly ok: false;
      readonly error: { readonly id: RuntimeErrorId; readonly message: string };
    };
