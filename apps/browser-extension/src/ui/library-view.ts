interface CaptureIdentity {
  readonly bundleId: string;
}

interface CaptureGroup {
  readonly captures: readonly CaptureIdentity[];
}

interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
}

interface ElementBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function dragImageHotspot(
  pointer: PointerPosition,
  bounds: ElementBounds,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.min(bounds.width, Math.max(0, pointer.clientX - bounds.left)),
    y: Math.min(bounds.height, Math.max(0, pointer.clientY - bounds.top)),
  };
}

export type LibraryGroupDestination =
  | { readonly screen: "detail"; readonly bundleId: string }
  | { readonly screen: "history" };

export function libraryGroupDestination(group: CaptureGroup): LibraryGroupDestination {
  const onlyCapture = group.captures.length === 1 ? group.captures[0] : undefined;
  return onlyCapture === undefined
    ? { screen: "history" }
    : { screen: "detail", bundleId: onlyCapture.bundleId };
}

export function collectionLayerBundleIds(group: CaptureGroup): readonly string[] {
  return group.captures.slice(0, 3).map((capture) => capture.bundleId);
}

export function mergeDropRequest(sourceCollectionId: string, destinationCollectionId: string) {
  if (sourceCollectionId === destinationCollectionId) return undefined;
  return {
    version: 1 as const,
    type: "MergeCollections" as const,
    destinationCollectionId,
    sourceCollectionIds: [sourceCollectionId],
  };
}

export function captureDropRequest(
  bundleIds: readonly string[],
  destinationCollectionId: string | "new",
) {
  const canonicalIds = [...new Set(bundleIds)].toSorted();
  if (canonicalIds.length === 0) return undefined;
  return destinationCollectionId === "new"
    ? { version: 1 as const, type: "ExtractCaptures" as const, bundleIds: canonicalIds }
    : {
        version: 1 as const,
        type: "MoveCaptures" as const,
        bundleIds: canonicalIds,
        destinationCollectionId,
      };
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Byte size must be non-negative.");
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted =
    unitIndex === 0
      ? String(Math.round(value))
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

export function libraryStateConfirmation(
  title: string,
  captureCount: number,
  operation: "Delete" | "Restore",
): string {
  if (operation === "Restore") {
    return `Restore “${title}” (${String(captureCount)} ${captureCount === 1 ? "capture" : "captures"}) to the Library?`;
  }
  return [
    `Delete “${title}” (${String(captureCount)} ${captureCount === 1 ? "capture" : "captures"})?`,
    "Deleted captures remain accessible and restorable in Deleted.",
    "They continue using storage until you run Vault Vacuum.",
  ].join("\n\n");
}
