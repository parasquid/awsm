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
  const vaultId = validated.manifest.originatingVaultId;
  if (validated.head.vaultId !== vaultId) {
    throw new Error("Validated Vault Package identity mismatch.");
  }
  const deviceId = crypto.randomUUID();
  const rootKeyCarrier = await importWrappableRootKey(rawRootKey);
  const { slot: deviceSlot, deviceKey } = await createDeviceSlot(rootKeyCarrier, vaultId, deviceId);
  const verifier = await createVerifier(rawRootKey, deviceSlot);
  return {
    metadata: {
      version: 1,
      vaultId,
      deviceId,
      createdAt: validated.vaultCreatedAt,
      manuallyLocked: true,
      verifier,
    },
    deviceSlot,
    deviceKey,
    generation: validated.generation,
    head: validated.head,
  };
}
