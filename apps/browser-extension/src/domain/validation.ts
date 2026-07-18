import { DomainValidationError } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ARTIFACT_ID_PATTERN = /^A[0-9]{6}$/u;

export function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainValidationError(field, "must be an object");
  }
  return Object.fromEntries(Object.entries(value));
}

export function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainValidationError(field, "must be a non-empty string");
  }
  return value;
}

export function literal<T extends string | number>(value: unknown, expected: T, field: string): T {
  if (value !== expected) {
    throw new DomainValidationError(field, `must equal ${expected}`);
  }
  return expected;
}

export function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(field, "must be a non-negative safe integer");
  }
  return value;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new DomainValidationError(field, "must be a boolean");
  }
  return value;
}

export function uuid(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!UUID_PATTERN.test(parsed)) {
    throw new DomainValidationError(field, "must be a canonical UUID");
  }
  return parsed;
}

export function artifactId(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!ARTIFACT_ID_PATTERN.test(parsed)) {
    throw new DomainValidationError(field, "must use the canonical Bundle-local Artifact format");
  }
  return parsed;
}

export function timestamp(value: unknown, field: string): string {
  const parsed = string(value, field);
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== parsed) {
    throw new DomainValidationError(field, "must be a canonical UTC timestamp");
  }
  return parsed;
}

export function httpUrl(value: unknown, field: string): string {
  const parsed = string(value, field);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new DomainValidationError(field, "must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainValidationError(field, "must use HTTP(S)");
  }
  return parsed;
}

export function bytes(value: unknown, length: number | undefined, field: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new DomainValidationError(field, "must be bytes");
  }
  if (length !== undefined && value.byteLength !== length) {
    throw new DomainValidationError(field, `must contain ${length} bytes`);
  }
  return value;
}
