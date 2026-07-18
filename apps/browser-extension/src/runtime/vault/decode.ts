import { DomainValidationError } from "../../domain/errors";
import { boolean, bytes, integer, literal, record, timestamp, uuid } from "../../domain/validation";
import type {
  DeviceKeySlotV1,
  PassphraseKeySlotV1,
  VaultMetadataV1,
  VaultRecordsV1,
} from "./contracts";

export function decodeVaultMetadata(value: unknown): VaultMetadataV1 {
  const input = record(value, "vaultMetadata");
  const verifier = record(input.verifier, "vaultMetadata.verifier");
  return {
    version: literal(input.version, 1, "vaultMetadata.version"),
    vaultId: uuid(input.vaultId, "vaultMetadata.vaultId"),
    deviceId: uuid(input.deviceId, "vaultMetadata.deviceId"),
    createdAt: timestamp(input.createdAt, "vaultMetadata.createdAt"),
    manuallyLocked: boolean(input.manuallyLocked, "vaultMetadata.manuallyLocked"),
    verifier: {
      version: literal(verifier.version, 1, "vaultMetadata.verifier.version"),
      nonce: bytes(verifier.nonce, 24, "vaultMetadata.verifier.nonce"),
      ciphertext: bytes(verifier.ciphertext, undefined, "vaultMetadata.verifier.ciphertext"),
    },
  };
}

export function decodeDeviceSlot(value: unknown): DeviceKeySlotV1 {
  const input = record(value, "deviceSlot");
  return {
    version: literal(input.version, 1, "deviceSlot.version"),
    slotId: uuid(input.slotId, "deviceSlot.slotId"),
    vaultId: uuid(input.vaultId, "deviceSlot.vaultId"),
    deviceId: uuid(input.deviceId, "deviceSlot.deviceId"),
    algorithm: literal(input.algorithm, "wrap:aes-kw-256:device:v1", "deviceSlot.algorithm"),
    wrappedRootKey: bytes(input.wrappedRootKey, 40, "deviceSlot.wrappedRootKey"),
  };
}

export function decodePassphraseSlot(value: unknown): PassphraseKeySlotV1 {
  const input = record(value, "passphraseSlot");
  return {
    version: literal(input.version, 1, "passphraseSlot.version"),
    slotId: uuid(input.slotId, "passphraseSlot.slotId"),
    vaultId: uuid(input.vaultId, "passphraseSlot.vaultId"),
    algorithm: literal(
      input.algorithm,
      "wrap:xchacha20poly1305:passphrase:v1",
      "passphraseSlot.algorithm",
    ),
    kdf: literal(input.kdf, "kdf:argon2id:v1", "passphraseSlot.kdf"),
    operations: literal(input.operations, 3, "passphraseSlot.operations"),
    memoryBytes: integer(input.memoryBytes, "passphraseSlot.memoryBytes"),
    salt: bytes(input.salt, 16, "passphraseSlot.salt"),
    nonce: bytes(input.nonce, 24, "passphraseSlot.nonce"),
    ciphertext: bytes(input.ciphertext, 48, "passphraseSlot.ciphertext"),
  };
}

export function decodeVaultRecords(input: {
  readonly metadata: unknown;
  readonly deviceSlot: unknown;
  readonly deviceKey: unknown;
  readonly passphraseSlot: unknown;
  readonly generations: unknown;
  readonly head: unknown;
}): VaultRecordsV1 {
  if (!(input.deviceKey instanceof CryptoKey) || input.deviceKey.extractable) {
    throw new DomainValidationError("deviceKey", "must be a non-exportable Web Crypto key");
  }
  const metadata = decodeVaultMetadata(input.metadata);
  const deviceSlot = decodeDeviceSlot(input.deviceSlot);
  if (metadata.vaultId !== deviceSlot.vaultId || metadata.deviceId !== deviceSlot.deviceId) {
    throw new DomainValidationError("deviceSlot", "does not belong to the active Vault and Device");
  }
  const passphraseSlot =
    input.passphraseSlot === undefined ? undefined : decodePassphraseSlot(input.passphraseSlot);
  if (passphraseSlot !== undefined && passphraseSlot.vaultId !== metadata.vaultId) {
    throw new DomainValidationError("passphraseSlot", "does not belong to the active Vault");
  }
  if (!Array.isArray(input.generations)) {
    throw new DomainValidationError("vaultGenerations", "must be an array");
  }
  const headInput = record(input.head, "vaultHead");
  const head = {
    version: literal(headInput.version, 1, "vaultHead.version"),
    vaultId: uuid(headInput.vaultId, "vaultHead.vaultId"),
    generationId: uuid(headInput.generationId, "vaultHead.generationId"),
    generationNumber: integer(headInput.generationNumber, "vaultHead.generationNumber"),
    appendedObjectIds: uuidArray(headInput.appendedObjectIds, "vaultHead.appendedObjectIds"),
    appendedEventIds: uuidArray(headInput.appendedEventIds, "vaultHead.appendedEventIds"),
  } as const;
  if (head.vaultId !== metadata.vaultId) {
    throw new DomainValidationError("vaultHead", "does not belong to the active Vault");
  }
  const generationValue = input.generations.find((value) => {
    const candidate = record(value, "vaultGeneration");
    return candidate.generationId === head.generationId;
  });
  if (generationValue === undefined) {
    throw new DomainValidationError("vaultGeneration", "active generation is missing");
  }
  const generationInput = record(generationValue, "vaultGeneration");
  const generation = {
    version: literal(generationInput.version, 1, "vaultGeneration.version"),
    generationId: uuid(generationInput.generationId, "vaultGeneration.generationId"),
    generationNumber: integer(generationInput.generationNumber, "vaultGeneration.generationNumber"),
    ...(generationInput.predecessorGenerationId === undefined
      ? {}
      : {
          predecessorGenerationId: uuid(
            generationInput.predecessorGenerationId,
            "vaultGeneration.predecessorGenerationId",
          ),
        }),
    envelopeBytes: bytes(generationInput.envelopeBytes, undefined, "vaultGeneration.envelopeBytes"),
  };
  if (generation.generationNumber !== head.generationNumber) {
    throw new DomainValidationError("vaultGeneration", "does not match the active generation");
  }
  return {
    metadata,
    deviceSlot,
    deviceKey: input.deviceKey,
    ...(passphraseSlot === undefined ? {} : { passphraseSlot }),
    generation,
    head,
  };
}

function uuidArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new DomainValidationError(field, "must be an array");
  const result = value.map((entry, index) => uuid(entry, `${field}.${String(index)}`));
  if (
    new Set(result).size !== result.length ||
    result.join("\n") !== [...result].toSorted().join("\n")
  ) {
    throw new DomainValidationError(field, "must contain unique canonical sorted identifiers");
  }
  return result;
}
