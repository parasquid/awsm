export type StorageDriverErrorId =
  | "IMMUTABLE_OBJECT_CONFLICT"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_TRANSACTION_FAILED";

export class StorageDriverError extends Error {
  readonly id: StorageDriverErrorId;

  constructor(id: StorageDriverErrorId, message: string) {
    super(message);
    this.name = "StorageDriverError";
    this.id = id;
  }
}

export function storageError(error: unknown): StorageDriverError {
  if (error instanceof StorageDriverError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new StorageDriverError("STORAGE_QUOTA_EXCEEDED", "Local storage quota was exceeded.");
  }
  const reason = error instanceof Error ? error.name : "UnknownError";
  return new StorageDriverError(
    "STORAGE_TRANSACTION_FAILED",
    `The storage transaction failed (${reason}).`,
  );
}
