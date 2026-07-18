import type { ArtifactRole } from "../../domain/artifact-graph";
import {
  CAPTURE_WARNINGS,
  type CaptureWarningId,
  type LibraryItemV1,
} from "../../domain/contracts";
import { DomainValidationError } from "../../domain/errors";
import {
  bytes,
  canonicalRecord,
  httpUrl,
  literal,
  string,
  timestamp,
  uuid,
} from "../../domain/validation";

const ARTIFACT_ROLES: readonly ArtifactRole[] = [
  "CONTENT_STRUCTURED",
  "PRIMARY",
  "SCREENSHOT_FULL",
  "TEXT_EXTRACTED",
  "THUMBNAIL",
];

function decodeArtifactRoles(value: unknown): readonly ArtifactRole[] {
  if (!Array.isArray(value))
    throw new DomainValidationError("libraryItem.artifactRoles", "must be an array");
  const roles = value.map((candidate, index) => {
    if (!ARTIFACT_ROLES.includes(candidate as ArtifactRole))
      throw new DomainValidationError(`libraryItem.artifactRoles.${index}`, "is unsupported");
    return candidate as ArtifactRole;
  });
  if (new Set(roles).size !== roles.length || roles.join("\n") !== [...roles].toSorted().join("\n"))
    throw new DomainValidationError("libraryItem.artifactRoles", "must be sorted and unique");
  if (!roles.includes("PRIMARY"))
    throw new DomainValidationError("libraryItem.artifactRoles", "must contain PRIMARY");
  return roles;
}

export function decodeLibraryItem(value: unknown): LibraryItemV1 {
  const input = canonicalRecord(value, "libraryItem", [
    "version",
    "bundleId",
    "descriptorObjectId",
    "assignedCollectionId",
    "title",
    "originalUrl",
    "capturedAt",
    "artifactRoles",
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
    descriptorObjectId: uuid(input.descriptorObjectId, "libraryItem.descriptorObjectId"),
    assignedCollectionId: uuid(input.assignedCollectionId, "libraryItem.assignedCollectionId"),
    title: string(input.title, "libraryItem.title"),
    originalUrl: httpUrl(input.originalUrl, "libraryItem.originalUrl"),
    capturedAt: timestamp(input.capturedAt, "libraryItem.capturedAt"),
    artifactRoles: decodeArtifactRoles(input.artifactRoles),
    status: input.status,
    ...(input.thumbnailWebp === undefined
      ? {}
      : { thumbnailWebp: bytes(input.thumbnailWebp, undefined, "libraryItem.thumbnailWebp") }),
    warnings,
  };
}
