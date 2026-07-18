import type { CaptureWarningId, LibraryItemV1 } from "../../domain/contracts";

export interface BundleRegisteredProjectionEventV1 {
  readonly eventId: string;
  readonly eventType: "BundleRegistered";
  readonly bundleId: string;
  readonly bundleObjectId: string;
  readonly collectionId: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly capturedAt: string;
  readonly screenshotPresent: boolean;
  readonly thumbnailWebp?: Uint8Array;
  readonly warnings: readonly CaptureWarningId[];
}

export interface CapturesDeletedProjectionEventV1 {
  readonly eventId: string;
  readonly eventType: "CapturesDeleted";
  readonly bundleIds: readonly string[];
}

export interface CapturesRestoredProjectionEventV1 {
  readonly eventId: string;
  readonly eventType: "CapturesRestored";
  readonly bundleIds: readonly string[];
}

export interface CapturesMovedProjectionEventV1 {
  readonly eventId: string;
  readonly eventType: "CapturesMoved";
  readonly moves: readonly {
    readonly bundleId: string;
    readonly fromCollectionId: string;
    readonly toCollectionId: string;
  }[];
}

export type LibraryProjectionEventV1 =
  | BundleRegisteredProjectionEventV1
  | CapturesDeletedProjectionEventV1
  | CapturesRestoredProjectionEventV1
  | CapturesMovedProjectionEventV1;

export function reduceLibraryProjection(
  events: readonly LibraryProjectionEventV1[],
): readonly LibraryItemV1[] {
  const acceptedEventIds = new Set<string>();
  const items = new Map<string, LibraryItemV1>();
  for (const event of events) {
    if (acceptedEventIds.has(event.eventId)) continue;
    acceptedEventIds.add(event.eventId);
    if (event.eventType === "CapturesDeleted" || event.eventType === "CapturesRestored") {
      const status = event.eventType === "CapturesDeleted" ? "Deleted" : "Active";
      for (const bundleId of event.bundleIds) {
        const item = items.get(bundleId);
        if (item !== undefined) items.set(bundleId, { ...item, status });
      }
      continue;
    }
    if (event.eventType === "CapturesMoved") {
      for (const move of event.moves) {
        const item = items.get(move.bundleId);
        if (item?.assignedCollectionId !== move.fromCollectionId) continue;
        items.set(move.bundleId, { ...item, assignedCollectionId: move.toCollectionId });
      }
      continue;
    }
    if (items.has(event.bundleId)) continue;
    items.set(event.bundleId, {
      version: 1,
      bundleId: event.bundleId,
      bundleObjectId: event.bundleObjectId,
      assignedCollectionId: event.collectionId,
      title: event.title,
      originalUrl: event.originalUrl,
      capturedAt: event.capturedAt,
      screenshotPresent: event.screenshotPresent,
      status: "Active",
      ...(event.thumbnailWebp === undefined ? {} : { thumbnailWebp: event.thumbnailWebp }),
      warnings: event.warnings,
    });
  }
  return [...items.values()];
}
