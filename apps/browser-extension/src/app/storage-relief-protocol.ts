export type StorageReliefRequest =
  | { readonly type: "GetStorageReliefEstimate"; readonly expectedVaultId: string }
  | {
      readonly type: "StartStorageRelief";
      readonly expectedVaultId: string;
      readonly candidateArtifacts: number;
      readonly candidateBytes: number;
    }
  | {
      readonly type: "CancelStorageRelief";
      readonly expectedVaultId: string;
      readonly jobId: string;
    };

export type StorageReliefJobView = {
  readonly jobId: string;
  readonly state:
    | "Running"
    | "WaitingForUnlock"
    | "AuthenticationRequired"
    | "Succeeded"
    | "Failed"
    | "Cancelled";
  readonly stage:
    | "Synchronizing"
    | "Checking server copies"
    | "Freeing browser storage"
    | "Finishing";
  readonly candidateArtifacts: number;
  readonly candidateBytes: number;
  readonly verifiedArtifacts: number;
  readonly verifiedBytes: number;
  readonly freedArtifacts: number;
  readonly freedBytes: number;
  readonly skippedArtifacts: number;
  readonly skippedBytes: number;
  readonly cancellationRequested: boolean;
  readonly errorId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isStorageReliefRequest(value: unknown): value is StorageReliefRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  switch (value.type) {
    case "GetStorageReliefEstimate":
      return (
        hasOnlyKeys(value, ["type", "expectedVaultId"]) &&
        "expectedVaultId" in value &&
        isUuid(value.expectedVaultId)
      );
    case "StartStorageRelief":
      return (
        hasOnlyKeys(value, ["type", "expectedVaultId", "candidateArtifacts", "candidateBytes"]) &&
        "expectedVaultId" in value &&
        isUuid(value.expectedVaultId) &&
        "candidateArtifacts" in value &&
        isCounter(value.candidateArtifacts) &&
        "candidateBytes" in value &&
        isCounter(value.candidateBytes)
      );
    case "CancelStorageRelief":
      return (
        hasOnlyKeys(value, ["type", "expectedVaultId", "jobId"]) &&
        "expectedVaultId" in value &&
        isUuid(value.expectedVaultId) &&
        "jobId" in value &&
        isUuid(value.jobId)
      );
    default:
      return false;
  }
}
