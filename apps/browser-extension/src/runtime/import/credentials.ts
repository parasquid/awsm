import type { StoredVaultGenerationV1, StoredVaultHeadV1 } from "../../drivers/indexeddb/schema";
import type { ValidatedVaultPackage } from "../export";
import type { VaultRecordsV1 } from "../vault";
import { createDeviceSlot, createVerifier } from "../vault/slots";

async function importWrappableRootKey(rawRootKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(rawRootKey),
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"],
  );
}

export async function prepareImportedVaultCredentials(
  validated: ValidatedVaultPackage,
  rawRootKey: Uint8Array,
): Promise<VaultRecordsV1> {
  return prepareReplicaDeviceCredentials({
    vaultId: validated.manifest.originatingVaultId,
    vaultCreatedAt: validated.vaultCreatedAt,
    generation: validated.generation,
    head: validated.head,
    rawRootKey,
    manuallyLocked: true,
  });
}

export async function prepareReplicaDeviceCredentials(input: {
  readonly vaultId: string;
  readonly vaultCreatedAt: string;
  readonly generation: StoredVaultGenerationV1;
  readonly head: StoredVaultHeadV1;
  readonly rawRootKey: Uint8Array;
  readonly manuallyLocked: boolean;
}): Promise<VaultRecordsV1> {
  const vaultId = input.vaultId;
  if (input.head.vaultId !== vaultId) {
    throw new Error("Validated Vault Package identity mismatch.");
  }
  const deviceId = crypto.randomUUID();
  const rootKeyCarrier = await importWrappableRootKey(input.rawRootKey);
  const { slot: deviceSlot, deviceKey } = await createDeviceSlot(rootKeyCarrier, vaultId, deviceId);
  const verifier = await createVerifier(input.rawRootKey, deviceSlot);
  return {
    metadata: {
      version: 1,
      vaultId,
      deviceId,
      createdAt: input.vaultCreatedAt,
      manuallyLocked: input.manuallyLocked,
      verifier,
    },
    deviceSlot,
    deviceKey,
    generation: input.generation,
    head: input.head,
  };
}
