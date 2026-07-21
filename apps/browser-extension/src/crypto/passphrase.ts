import { DomainValidationError } from "../domain/errors";
import { readySodium } from "./sodium";

export interface PassphraseKeyInput {
  readonly passphrase: string;
  readonly salt: Uint8Array;
  readonly operations: 3;
  readonly memoryBytes: number;
}

export async function derivePassphraseKey(input: PassphraseKeyInput): Promise<Uint8Array> {
  if (input.salt.byteLength !== 16) {
    throw new DomainValidationError("passphrase.salt", "must contain 16 bytes");
  }
  if (input.memoryBytes !== 64 * 1024 * 1024) {
    throw new DomainValidationError("passphrase.memoryBytes", "must equal 64 MiB");
  }
  const sodium = await readySodium();
  return sodium.crypto_pwhash(
    32,
    input.passphrase,
    input.salt,
    input.operations,
    input.memoryBytes,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}
