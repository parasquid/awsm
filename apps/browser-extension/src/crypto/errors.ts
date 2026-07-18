export class CryptoOperationError extends Error {
  readonly id = "CRYPTO_AUTHENTICATION_FAILED" as const;

  constructor() {
    super("Encrypted data could not be authenticated.");
    this.name = "CryptoOperationError";
  }
}
