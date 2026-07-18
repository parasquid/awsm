interface CaptureIdentity {
  readonly bundleId: string;
}

interface CaptureGroup {
  readonly captures: readonly CaptureIdentity[];
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
