import { hkdfSha256 } from "../../crypto/hkdf";
import { derivePassphraseKey } from "../../crypto/passphrase";
import { wipe } from "../../crypto/sodium";
import { xchachaDecrypt, xchachaEncrypt } from "../../crypto/xchacha";
import { encodeCanonicalCbor } from "../../domain/cbor";
import { DomainValidationError } from "../../domain/errors";

const encoder = new TextEncoder();

export const ACCOUNT_KDF_ALGORITHM = "kdf:argon2id13:account:v1" as const;
export const ACCOUNT_KEY_WRAP_ALGORITHM = "wrap:xchacha20poly1305:account-password:v1" as const;
export const ACCOUNT_VAULT_SLOT_ALGORITHM = "wrap:xchacha20poly1305:account:v1" as const;
export const ACCOUNT_KDF_OPERATIONS = 3 as const;
export const ACCOUNT_KDF_MEMORY_BYTES = 64 * 1024 * 1024;

export interface AccountKeyEnvelopeV1 {
  readonly version: 1;
  readonly accountKeyId: string;
  readonly kdfAlgorithm: typeof ACCOUNT_KDF_ALGORITHM;
  readonly kdfSalt: Uint8Array;
  readonly kdfOperations: 3;
  readonly kdfMemoryBytes: number;
  readonly wrappingAlgorithm: typeof ACCOUNT_KEY_WRAP_ALGORITHM;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface AccountVaultSlotV1 {
  readonly version: 1;
  readonly slotId: string;
  readonly vaultId: string;
  readonly accountKeyId: string;
  readonly algorithm: typeof ACCOUNT_VAULT_SLOT_ALGORITHM;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function uuidBytes(uuid: string): Uint8Array {
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new DomainValidationError("accountKeyId", "must be a lowercase UUID");
  }
  return Uint8Array.from(compact.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function requireBytes(name: string, value: Uint8Array, length: number): void {
  if (value.byteLength !== length) {
    throw new DomainValidationError(name, `must contain ${length} bytes`);
  }
}

export async function deriveAccountPasswordKeys(input: {
  readonly password: string;
  readonly accountKeyId: string;
  readonly salt: Uint8Array;
}): Promise<{
  readonly authenticationDerivative: Uint8Array;
  readonly passwordWrappingKey: Uint8Array;
}> {
  const master = await derivePassphraseKey({
    passphrase: input.password,
    salt: input.salt,
    operations: ACCOUNT_KDF_OPERATIONS,
    memoryBytes: ACCOUNT_KDF_MEMORY_BYTES,
  });
  const domainSalt = uuidBytes(input.accountKeyId);
  try {
    const [authenticationDerivative, passwordWrappingKey] = await Promise.all([
      hkdfSha256({
        inputKeyMaterial: master,
        salt: domainSalt,
        info: encoder.encode("account:authentication:v1"),
        length: 32,
      }),
      hkdfSha256({
        inputKeyMaterial: master,
        salt: domainSalt,
        info: encoder.encode("account:password-wrapping:v1"),
        length: 32,
      }),
    ]);
    return { authenticationDerivative, passwordWrappingKey };
  } finally {
    await wipe(master);
  }
}

export function accountKeyEnvelopeAad(envelope: AccountKeyEnvelopeV1): Uint8Array {
  return encodeCanonicalCbor([
    envelope.version,
    envelope.accountKeyId,
    envelope.kdfAlgorithm,
    envelope.kdfSalt,
    envelope.kdfOperations,
    envelope.kdfMemoryBytes,
    envelope.wrappingAlgorithm,
    envelope.nonce,
  ]);
}

export async function createAccountKeyEnvelope(input: {
  readonly accountKeyId: string;
  readonly salt: Uint8Array;
  readonly accountEncryptionKey: Uint8Array;
  readonly passwordWrappingKey: Uint8Array;
  readonly nonce?: Uint8Array;
}): Promise<AccountKeyEnvelopeV1> {
  requireBytes("accountEncryptionKey", input.accountEncryptionKey, 32);
  requireBytes("passwordWrappingKey", input.passwordWrappingKey, 32);
  requireBytes("kdfSalt", input.salt, 16);
  const envelope: AccountKeyEnvelopeV1 = {
    version: 1,
    accountKeyId: input.accountKeyId,
    kdfAlgorithm: ACCOUNT_KDF_ALGORITHM,
    kdfSalt: Uint8Array.from(input.salt),
    kdfOperations: ACCOUNT_KDF_OPERATIONS,
    kdfMemoryBytes: ACCOUNT_KDF_MEMORY_BYTES,
    wrappingAlgorithm: ACCOUNT_KEY_WRAP_ALGORITHM,
    nonce: input.nonce ?? crypto.getRandomValues(new Uint8Array(24)),
    ciphertext: new Uint8Array(),
  };
  requireBytes("nonce", envelope.nonce, 24);
  return {
    ...envelope,
    ciphertext: await xchachaEncrypt({
      plaintext: input.accountEncryptionKey,
      aad: accountKeyEnvelopeAad(envelope),
      nonce: envelope.nonce,
      key: input.passwordWrappingKey,
    }),
  };
}

function validateAccountEnvelope(envelope: AccountKeyEnvelopeV1): void {
  if (
    envelope.version !== 1 ||
    envelope.kdfAlgorithm !== ACCOUNT_KDF_ALGORITHM ||
    envelope.kdfOperations !== ACCOUNT_KDF_OPERATIONS ||
    envelope.kdfMemoryBytes !== ACCOUNT_KDF_MEMORY_BYTES ||
    envelope.wrappingAlgorithm !== ACCOUNT_KEY_WRAP_ALGORITHM
  ) {
    throw new DomainValidationError("accountKeyEnvelope", "contains unsupported metadata");
  }
  uuidBytes(envelope.accountKeyId);
  requireBytes("accountKeyEnvelope.kdfSalt", envelope.kdfSalt, 16);
  requireBytes("accountKeyEnvelope.nonce", envelope.nonce, 24);
  requireBytes("accountKeyEnvelope.ciphertext", envelope.ciphertext, 48);
}

export async function openAccountKeyEnvelope(
  envelope: AccountKeyEnvelopeV1,
  passwordWrappingKey: Uint8Array,
): Promise<Uint8Array> {
  validateAccountEnvelope(envelope);
  requireBytes("passwordWrappingKey", passwordWrappingKey, 32);
  return xchachaDecrypt({
    ciphertext: envelope.ciphertext,
    aad: accountKeyEnvelopeAad(envelope),
    nonce: envelope.nonce,
    key: passwordWrappingKey,
  });
}

export function accountVaultSlotAad(slot: AccountVaultSlotV1): Uint8Array {
  return encodeCanonicalCbor([
    slot.version,
    slot.slotId,
    slot.vaultId,
    slot.accountKeyId,
    slot.algorithm,
    slot.nonce,
  ]);
}

export async function createAccountVaultSlot(input: {
  readonly slotId?: string;
  readonly vaultId: string;
  readonly accountKeyId: string;
  readonly accountEncryptionKey: Uint8Array;
  readonly vaultRootKey: Uint8Array;
  readonly nonce?: Uint8Array;
}): Promise<AccountVaultSlotV1> {
  requireBytes("accountEncryptionKey", input.accountEncryptionKey, 32);
  requireBytes("vaultRootKey", input.vaultRootKey, 32);
  const slot: AccountVaultSlotV1 = {
    version: 1,
    slotId: input.slotId ?? crypto.randomUUID(),
    vaultId: input.vaultId,
    accountKeyId: input.accountKeyId,
    algorithm: ACCOUNT_VAULT_SLOT_ALGORITHM,
    nonce: input.nonce ?? crypto.getRandomValues(new Uint8Array(24)),
    ciphertext: new Uint8Array(),
  };
  uuidBytes(slot.slotId);
  uuidBytes(slot.vaultId);
  uuidBytes(slot.accountKeyId);
  requireBytes("accountVaultSlot.nonce", slot.nonce, 24);
  return {
    ...slot,
    ciphertext: await xchachaEncrypt({
      plaintext: input.vaultRootKey,
      aad: accountVaultSlotAad(slot),
      nonce: slot.nonce,
      key: input.accountEncryptionKey,
    }),
  };
}

export async function openAccountVaultSlot(
  slot: AccountVaultSlotV1,
  accountEncryptionKey: Uint8Array,
): Promise<Uint8Array> {
  if (slot.version !== 1 || slot.algorithm !== ACCOUNT_VAULT_SLOT_ALGORITHM) {
    throw new DomainValidationError("accountVaultSlot", "contains unsupported metadata");
  }
  uuidBytes(slot.slotId);
  uuidBytes(slot.vaultId);
  uuidBytes(slot.accountKeyId);
  requireBytes("accountVaultSlot.nonce", slot.nonce, 24);
  requireBytes("accountVaultSlot.ciphertext", slot.ciphertext, 48);
  requireBytes("accountEncryptionKey", accountEncryptionKey, 32);
  return xchachaDecrypt({
    ciphertext: slot.ciphertext,
    aad: accountVaultSlotAad(slot),
    nonce: slot.nonce,
    key: accountEncryptionKey,
  });
}
