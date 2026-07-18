import {
  CAPTURE_WARNINGS,
  type CaptureWarningId,
  type LibraryItemV1,
} from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import {
  boolean,
  bytes,
  canonicalRecord,
  httpUrl,
  literal,
  string,
  timestamp,
  uuid,
} from "../../domain/validation";

export function decodeLibraryItem(value: unknown): LibraryItemV1 {
  const input = canonicalRecord(value, "libraryItem", [
    "version",
    "bundleId",
    "bundleObjectId",
    "assignedCollectionId",
    "title",
    "originalUrl",
    "capturedAt",
    "screenshotPresent",
    "status",
    "thumbnailWebp",
    "warnings",
  ]);
  if (!Array.isArray(input.warnings)) {
    throw new DomainValidationError("libraryItem.warnings", "must be an array");
  }
  const warnings = input.warnings.map((warning, index) => {
    if (typeof warning !== "string" || !CAPTURE_WARNINGS.includes(warning as CaptureWarningId)) {
      throw new DomainValidationError(`libraryItem.warnings.${index}`, "is unsupported");
    }
    return warning as CaptureWarningId;
  });
  if (input.status !== "Active" && input.status !== "Deleted") {
    throw new DomainValidationError("libraryItem.status", "must be Active or Deleted");
  }
  return {
    version: literal(input.version, 1, "libraryItem.version"),
    bundleId: uuid(input.bundleId, "libraryItem.bundleId"),
    bundleObjectId: uuid(input.bundleObjectId, "libraryItem.bundleObjectId"),
    assignedCollectionId: uuid(input.assignedCollectionId, "libraryItem.assignedCollectionId"),
    title: string(input.title, "libraryItem.title"),
    originalUrl: httpUrl(input.originalUrl, "libraryItem.originalUrl"),
    capturedAt: timestamp(input.capturedAt, "libraryItem.capturedAt"),
    screenshotPresent: boolean(input.screenshotPresent, "libraryItem.screenshotPresent"),
    status: input.status,
    ...(input.thumbnailWebp === undefined
      ? {}
      : { thumbnailWebp: bytes(input.thumbnailWebp, undefined, "libraryItem.thumbnailWebp") }),
    warnings,
  };
}
