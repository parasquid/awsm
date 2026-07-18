import { CryptoOperationError } from "./errors";
import { readySodium } from "./sodium";

export interface XChaChaEncryptInput {
  readonly plaintext: Uint8Array;
  readonly aad: Uint8Array;
  readonly nonce: Uint8Array;
  readonly key: Uint8Array;
}

export interface XChaChaDecryptInput {
  readonly ciphertext: Uint8Array;
  readonly aad: Uint8Array;
  readonly nonce: Uint8Array;
  readonly key: Uint8Array;
}

export async function xchachaEncrypt(input: XChaChaEncryptInput): Promise<Uint8Array> {
  const sodium = await readySodium();
  return Uint8Array.from(
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      input.plaintext,
      input.aad,
      null,
      input.nonce,
      input.key,
    ),
  );
}

export async function xchachaDecrypt(input: XChaChaDecryptInput): Promise<Uint8Array> {
  const sodium = await readySodium();
  try {
    return Uint8Array.from(
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        input.ciphertext,
        input.aad,
        input.nonce,
        input.key,
      ),
    );
  } catch {
    throw new CryptoOperationError();
  }
}
