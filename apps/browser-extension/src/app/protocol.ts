import type { ArtifactRole, CaptureMetadataV1 } from "../domain/artifact-graph";
import type {
  CaptureJob,
  CaptureWarningId,
  LibraryItemV1,
  RuntimeErrorId,
} from "../domain/contracts";
import type { ExportJobV1 } from "../drivers/indexeddb/schema";
import type { ArtifactDetailItem } from "../runtime/library/service";
import type { WorkspaceState } from "../runtime/vault/workspace-service";

type ExpectedVault = { readonly expectedVaultId: string };

export type AppRequest =
  | { readonly type: "GetState" }
  | { readonly type: "SuggestVaultName" }
  | {
      readonly type: "CreateVault";
      readonly expectedActiveVaultId?: string;
      readonly name: string;
    }
  | {
      readonly type: "SelectActiveVault";
      readonly expectedActiveVaultId: string;
      readonly vaultId: string;
    }
  | {
      readonly type: "RenameVault";
      readonly expectedActiveVaultId: string;
      readonly vaultId: string;
      readonly name: string;
    }
  | ({ readonly type: "UnlockDevice" } & ExpectedVault)
  | ({ readonly type: "LockVault" } & ExpectedVault)
  | ({ readonly type: "DismissRecentCapture"; readonly jobId: string } & ExpectedVault)
  | ({ readonly type: "CaptureActivePage"; readonly tabId?: number } & ExpectedVault)
  | ({ readonly type: "ListLibrary" } & ExpectedVault)
  | ({ readonly type: "ListDeleted" } & ExpectedVault)
  | ({ readonly type: "DeleteCaptures"; readonly bundleIds: readonly string[] } & ExpectedVault)
  | ({ readonly type: "RestoreCaptures"; readonly bundleIds: readonly string[] } & ExpectedVault)
  | ({
      readonly type: "MergeCollections";
      readonly destinationCollectionId: string;
      readonly sourceCollectionIds: readonly string[];
    } & ExpectedVault)
  | ({
      readonly type: "MoveCaptures";
      readonly bundleIds: readonly string[];
      readonly destinationCollectionId: string;
    } & ExpectedVault)
  | ({ readonly type: "ExtractCaptures"; readonly bundleIds: readonly string[] } & ExpectedVault)
  | ({ readonly type: "UndoLibraryOperation"; readonly operationEventId: string } & ExpectedVault)
  | ({ readonly type: "VacuumVault" } & ExpectedVault)
  | ({ readonly type: "GetVacuumEstimate" } & ExpectedVault)
  | ({ readonly type: "ExportVault"; readonly passphrase: string } & ExpectedVault)
  | ({ readonly type: "CancelVaultExport"; readonly jobId: string } & ExpectedVault)
  | ({ readonly type: "GetLibraryDetail"; readonly bundleId: string } & ExpectedVault)
  | ({
      readonly type: "OpenArtifact";
      readonly bundleId: string;
      readonly role: ArtifactRole;
    } & ExpectedVault)
  | ({ readonly type: "ReadArtifactChunk"; readonly sessionId: string } & ExpectedVault)
  | ({ readonly type: "CancelArtifactSession"; readonly sessionId: string } & ExpectedVault);

const APP_REQUEST_TYPES: ReadonlySet<AppRequest["type"]> = new Set([
  "GetState",
  "SuggestVaultName",
  "CreateVault",
  "SelectActiveVault",
  "RenameVault",
  "UnlockDevice",
  "LockVault",
  "DismissRecentCapture",
  "CaptureActivePage",
  "ListLibrary",
  "ListDeleted",
  "DeleteCaptures",
  "RestoreCaptures",
  "MergeCollections",
  "MoveCaptures",
  "ExtractCaptures",
  "UndoLibraryOperation",
  "VacuumVault",
  "GetVacuumEstimate",
  "ExportVault",
  "CancelVaultExport",
  "GetLibraryDetail",
  "OpenArtifact",
  "ReadArtifactChunk",
  "CancelArtifactSession",
]);

export function isAppRequest(value: unknown): value is AppRequest {
  const recognized =
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    APP_REQUEST_TYPES.has(value.type as AppRequest["type"]);
  if (!recognized) return false;
  if ("expectedVaultId" in value && typeof value.expectedVaultId !== "string") return false;
  if (value.type === "CreateVault" && "passphrase" in value) return false;
  if (
    value.type === "ExportVault" &&
    (!("passphrase" in value) || typeof value.passphrase !== "string")
  )
    return false;
  if (
    value.type === "OpenArtifact" &&
    (!("bundleId" in value) ||
      typeof value.bundleId !== "string" ||
      !("role" in value) ||
      !["PRIMARY", "SCREENSHOT_FULL", "THUMBNAIL", "TEXT_EXTRACTED", "CONTENT_STRUCTURED"].includes(
        String(value.role),
      ))
  )
    return false;
  if (
    (value.type === "ReadArtifactChunk" || value.type === "CancelArtifactSession") &&
    (!("sessionId" in value) || typeof value.sessionId !== "string")
  )
    return false;
  if (
    value.type === "CancelVaultExport" &&
    (!("jobId" in value) || typeof value.jobId !== "string")
  )
    return false;
  return true;
}

export interface AppState {
  readonly workspace: WorkspaceState;
  readonly latestJob?: CaptureJob;
  readonly latestWarnings?: readonly CaptureWarningId[];
  readonly recentCapture?: RecentCapture;
  readonly latestExportJob?: ExportJobV1;
}

export interface RecentCapture {
  readonly vaultId: string;
  readonly jobId: string;
  readonly bundleId: string;
  readonly title: string;
  readonly screenshotBase64?: string;
  readonly warnings: readonly CaptureWarningId[];
}

export interface AppStateChanged {
  readonly type: "AppStateChanged";
}

export interface LibraryDetailMessage {
  readonly item: LibraryItemV1;
  readonly metadata: CaptureMetadataV1;
  readonly artifacts: readonly ArtifactDetailItem[];
}

export interface OpenArtifactMessage {
  readonly sessionId: string;
  readonly role: ArtifactRole;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly filename: string;
}

export interface ArtifactChunkMessage {
  readonly done: boolean;
  readonly chunkBase64?: string;
}

export interface LibraryPageGroupMessage {
  readonly collectionId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly knownUrls: readonly string[];
  readonly latest: LibraryItemV1;
  readonly captures: readonly LibraryItemV1[];
  readonly captureThumbnails: readonly LibraryCaptureThumbnail[];
}

export interface LibraryCaptureThumbnail {
  readonly bundleId: string;
  readonly thumbnailBase64?: string;
}

export interface LibraryOperationReceipt {
  readonly operationEventId: string;
  readonly destinationCollectionId: string;
}

export type AppValue =
  | AppState
  | readonly LibraryPageGroupMessage[]
  | LibraryDetailMessage
  | LibraryOperationReceipt
  | OpenArtifactMessage
  | ArtifactChunkMessage
  | { readonly name: string }
  | { readonly bundleId: string }
  | { readonly jobId: string; readonly filename: string }
  | { readonly deletedCaptureCount: number; readonly reclaimedBytes: number }
  | { readonly deletedCaptureCount: number; readonly reclaimableBytes: number }
  | null;

export type AppResponse =
  | { readonly ok: true; readonly value: AppValue }
  | {
      readonly ok: false;
      readonly error: { readonly id: RuntimeErrorId; readonly message: string };
    };
