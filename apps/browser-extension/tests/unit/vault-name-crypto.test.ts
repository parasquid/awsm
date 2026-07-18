import { describe, expect, it } from "vitest";
import {
  decodeVaultNameEvent,
  decryptVaultNameProjection,
  prepareVaultNameChange,
} from "../../src/runtime/vault/name-crypto";

const vaultId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";
const timestamp = "2026-07-18T15:00:00.000Z";

async function rootKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), "HKDF", false, ["deriveBits"]);
}

describe("encrypted Vault name state", () => {
  it("prepares matching authoritative Event and rebuildable Projection ciphertext", async () => {
    const key = await rootKey();
    const prepared = await prepareVaultNameChange({
      rootKey: key,
      eventType: "VaultCreated",
      vaultId,
      deviceId,
      eventId,
      timestamp,
      name: "Amber Archive",
    });

    expect(prepared.event).toMatchObject({
      version: 1,
      vaultId,
      eventId,
      referencedObjectIds: [],
      orderingTimestamp: timestamp,
    });
    expect(prepared.projection).toMatchObject({ version: 1, vaultId, sourceEventId: eventId });
    await expect(decodeVaultNameEvent(key, prepared.event)).resolves.toMatchObject({
      version: 1,
      eventType: "VaultCreated",
      vaultId,
      deviceId,
      name: "Amber Archive",
      orderingTimestamp: timestamp,
    });
    await expect(decryptVaultNameProjection(key, prepared.projection)).resolves.toEqual({
      version: 1,
      vaultId,
      name: "Amber Archive",
      sourceEventId: eventId,
      updatedAt: timestamp,
    });
  });

  it("rejects a noncanonical name before producing ciphertext", async () => {
    await expect(
      prepareVaultNameChange({
        rootKey: await rootKey(),
        eventType: "VaultRenamed",
        vaultId,
        deviceId,
        eventId,
        timestamp,
        name: "  Amber   Archive  ",
      }),
    ).rejects.toMatchObject({ id: "INVALID_VAULT_NAME" });
  });
});
