export class DomainValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "DomainValidationError";
    this.field = field;
  }
}
