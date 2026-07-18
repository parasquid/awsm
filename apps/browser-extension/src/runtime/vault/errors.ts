export type VaultServiceErrorId =
  | "VAULT_LOCKED"
  | "VAULT_CONTEXT_CHANGED"
  | "CRYPTO_AUTHENTICATION_FAILED"
  | "STORAGE_TRANSACTION_FAILED";

export class VaultServiceError extends Error {
  readonly id: VaultServiceErrorId;

  constructor(id: VaultServiceErrorId, message: string) {
    super(message);
    this.name = "VaultServiceError";
    this.id = id;
  }
}
