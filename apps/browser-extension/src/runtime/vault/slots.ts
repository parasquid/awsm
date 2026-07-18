import { deriveContextKey, deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { derivePassphraseKey } from "../../crypto/passphrase";
import { wipe } from "../../crypto/sodium";
import { xchachaDecrypt, xchachaEncrypt } from "../../crypto/xchacha";
import { encodeCanonicalCbor } from "../../domain/cbor";
import type { DeviceKeySlotV1, PassphraseKeySlotV1, VaultVerifierV1 } from "./contracts";

const VERIFIER_PLAINTEXT = new TextEncoder().encode("AWSM-VAULT-VERIFIER-V1");

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function deviceSlotAad(slot: DeviceKeySlotV1): Uint8Array {
  return encodeCanonicalCbor([
    slot.version,
    slot.vaultId,
    slot.deviceId,
    slot.slotId,
    slot.algorithm,
  ]);
}

function passphraseSlotAad(slot: PassphraseKeySlotV1): Uint8Array {
  return encodeCanonicalCbor([
    slot.version,
    slot.vaultId,
    slot.slotId,
    slot.algorithm,
    slot.kdf,
    slot.operations,
    slot.memoryBytes,
    slot.salt,
  ]);
}

export async function createDeviceSlot(
  rootKey: CryptoKey,
  vaultId: string,
  deviceId: string,
): Promise<{ readonly slot: DeviceKeySlotV1; readonly deviceKey: CryptoKey }> {
  const slotId = crypto.randomUUID();
  const deviceKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
  const wrapped = await crypto.subtle.wrapKey("raw", rootKey, deviceKey, "AES-KW");
  return {
    slot: {
      version: 1,
      slotId,
      vaultId,
      deviceId,
      algorithm: "wrap:aes-kw-256:device:v1",
      wrappedRootKey: new Uint8Array(wrapped),
    },
    deviceKey,
  };
}

export async function unwrapDeviceSlot(
  slot: DeviceKeySlotV1,
  deviceKey: CryptoKey,
): Promise<Uint8Array> {
  const rootCarrier = await crypto.subtle.unwrapKey(
    "raw",
    Uint8Array.from(slot.wrappedRootKey),
    deviceKey,
    "AES-KW",
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", rootCarrier));
}

export async function createPassphraseSlot(
  rawRootKey: Uint8Array,
  vaultId: string,
  passphrase: string,
): Promise<PassphraseKeySlotV1> {
  const base = {
    version: 1,
    slotId: crypto.randomUUID(),
    vaultId,
    algorithm: "wrap:xchacha20poly1305:passphrase:v1",
    kdf: "kdf:argon2id:v1",
    operations: 3,
    memoryBytes: 64 * 1024 * 1024,
    salt: randomBytes(16),
    nonce: randomBytes(24),
  } as const;
  const placeholder: PassphraseKeySlotV1 = {
    ...base,
    ciphertext: new Uint8Array(rawRootKey.byteLength + 16),
  };
  const key = await derivePassphraseKey({
    passphrase,
    salt: base.salt,
    operations: base.operations,
    memoryBytes: base.memoryBytes,
  });
  try {
    const ciphertext = await xchachaEncrypt({
      plaintext: rawRootKey,
      aad: passphraseSlotAad(placeholder),
      nonce: base.nonce,
      key,
    });
    return { ...base, ciphertext };
  } finally {
    await wipe(key);
  }
}

export async function unwrapPassphraseSlot(
  slot: PassphraseKeySlotV1,
  passphrase: string,
): Promise<Uint8Array> {
  const key = await derivePassphraseKey({
    passphrase,
    salt: slot.salt,
    operations: slot.operations,
    memoryBytes: slot.memoryBytes,
  });
  try {
    return await xchachaDecrypt({
      ciphertext: slot.ciphertext,
      aad: passphraseSlotAad(slot),
      nonce: slot.nonce,
      key,
    });
  } finally {
    await wipe(key);
  }
}

async function verifierKey(rootKey: CryptoKey, slot: DeviceKeySlotV1): Promise<Uint8Array> {
  return deriveContextKeyFromCryptoKey(rootKey, {
    vaultId: slot.vaultId,
    domain: "vault:verifier:v1",
    contextId: slot.slotId,
    keyVersion: 1,
  });
}

export async function createVerifier(
  rawRootKey: Uint8Array,
  slot: DeviceKeySlotV1,
): Promise<VaultVerifierV1> {
  const nonce = randomBytes(24);
  const key = await deriveContextKey({
    rootKey: rawRootKey,
    vaultId: slot.vaultId,
    domain: "vault:verifier:v1",
    contextId: slot.slotId,
    keyVersion: 1,
  });
  try {
    return {
      version: 1,
      nonce,
      ciphertext: await xchachaEncrypt({
        plaintext: VERIFIER_PLAINTEXT,
        aad: deviceSlotAad(slot),
        nonce,
        key,
      }),
    };
  } finally {
    await wipe(key);
  }
}

export async function verifyRootKey(
  rootKey: CryptoKey,
  slot: DeviceKeySlotV1,
  verifier: VaultVerifierV1,
): Promise<void> {
  const key = await verifierKey(rootKey, slot);
  try {
    const plaintext = await xchachaDecrypt({
      ciphertext: verifier.ciphertext,
      aad: deviceSlotAad(slot),
      nonce: verifier.nonce,
      key,
    });
    if (
      plaintext.byteLength !== VERIFIER_PLAINTEXT.byteLength ||
      plaintext.some((byte, index) => byte !== VERIFIER_PLAINTEXT[index])
    ) {
      throw new Error("Vault verifier mismatch");
    }
  } finally {
    await wipe(key);
  }
}
