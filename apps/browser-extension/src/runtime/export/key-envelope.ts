import { derivePassphraseKey } from "../../crypto/passphrase";
import { xchachaDecrypt, xchachaEncrypt } from "../../crypto/xchacha";
import { encodeCanonicalCbor } from "../../domain/cbor";
import { bytesEqual, sha256 } from "../../domain/hash";
import type { ExportKeyEnvelopeV1 } from "./contracts";

export class ExportAuthenticationError extends Error {
  readonly id = "EXPORT_AUTHENTICATION_FAILED";

  constructor() {
    super("The Export could not be authenticated.");
    this.name = "ExportAuthenticationError";
  }
}

function validateExportPassphrase(passphrase: string): void {
  const codePoints = Array.from(passphrase).length;
  const utf8Length = new TextEncoder().encode(passphrase).byteLength;
  if (codePoints < 12 || utf8Length > 1024) throw new ExportAuthenticationError();
}

function aad(envelope: Omit<ExportKeyEnvelopeV1, "ciphertext">): Uint8Array {
  return encodeCanonicalCbor([
    envelope.exportKeyEnvelopeVersion,
    envelope.purpose,
    envelope.packageId,
    envelope.originatingVaultId,
    envelope.algorithm,
    envelope.kdf,
    envelope.operations,
    envelope.memoryBytes,
    envelope.salt,
    envelope.nonce,
    envelope.manifestChecksumAlgorithm,
    envelope.manifestChecksum,
  ]);
}

export async function createExportKeyEnvelope(input: {
  readonly packageId: string;
  readonly originatingVaultId: string;
  readonly manifestBytes: Uint8Array;
  readonly passphrase: string;
  readonly rootKey: Uint8Array;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
}): Promise<ExportKeyEnvelopeV1> {
  if (input.rootKey.byteLength !== 32) throw new ExportAuthenticationError();
  validateExportPassphrase(input.passphrase);
  const manifestChecksum = await sha256(input.manifestBytes);
  const fields = {
    exportKeyEnvelopeVersion: 1,
    purpose: "VaultExport",
    packageId: input.packageId,
    originatingVaultId: input.originatingVaultId,
    algorithm: "wrap:xchacha20poly1305:passphrase:v1",
    kdf: "kdf:argon2id:v1",
    operations: 3,
    memoryBytes: 67108864,
    salt: Uint8Array.from(input.salt),
    nonce: Uint8Array.from(input.nonce),
    manifestChecksumAlgorithm: "hash:sha256:v1",
    manifestChecksum,
  } as const;
  const key = await derivePassphraseKey({
    passphrase: input.passphrase,
    salt: fields.salt,
    operations: 3,
    memoryBytes: 67108864,
  });
  try {
    return {
      ...fields,
      ciphertext: await xchachaEncrypt({
        plaintext: input.rootKey,
        aad: aad(fields),
        nonce: fields.nonce,
        key,
      }),
    };
  } finally {
    key.fill(0);
  }
}

export async function openExportKeyEnvelope(
  envelope: ExportKeyEnvelopeV1,
  manifestBytes: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  validateExportPassphrase(passphrase);
  const actualManifestChecksum = await sha256(manifestBytes);
  if (!bytesEqual(actualManifestChecksum, envelope.manifestChecksum)) {
    throw new ExportAuthenticationError();
  }
  let key: Uint8Array | undefined;
  try {
    key = await derivePassphraseKey({
      passphrase,
      salt: envelope.salt,
      operations: 3,
      memoryBytes: 67108864,
    });
    return await xchachaDecrypt({
      ciphertext: envelope.ciphertext,
      aad: aad(envelope),
      nonce: envelope.nonce,
      key,
    });
  } catch {
    throw new ExportAuthenticationError();
  } finally {
    key?.fill(0);
  }
}
