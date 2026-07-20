import { describe, expect, it } from "vitest";
import { createAccountVaultSlot } from "../../src/runtime/account/crypto";
import { bytesToBase64Url } from "../../src/runtime/account/wire";
import { ServerSwitchCandidateInspector } from "../../src/runtime/synchronization/server-switch-inspection";

const accountId = "01900000-0000-7000-8000-000000000001";
const accountKeyId = "01900000-0000-7000-8000-000000000002";
const vaultId = "01900000-0000-7000-8000-000000000003";
const generationId = "01900000-0000-7000-8000-000000000004";
const accountKey = new Uint8Array(32).fill(3);
const rootKey = new Uint8Array(32).fill(7);

async function resource() {
  const slot = await createAccountVaultSlot({
    slotId: "01900000-0000-7000-8000-000000000005",
    vaultId,
    accountKeyId,
    accountEncryptionKey: accountKey,
    vaultRootKey: rootKey,
    nonce: new Uint8Array(24).fill(9),
  });
  return {
    vaultId,
    state: "Active",
    generationId,
    generationNumber: 4,
    predecessorGenerationId: "01900000-0000-7000-8000-000000000006",
    headCursor: 17,
    accountSlot: {
      ...slot,
      nonce: bytesToBase64Url(slot.nonce),
      ciphertext: bytesToBase64Url(slot.ciphertext),
    },
  };
}

function inspector(vaults: unknown[]) {
  return new ServerSwitchCandidateInspector(
    {
      loadMetadata: async () => ({
        version: 1,
        accountId,
        sessionId: accountId,
        email: "candidate@example.test",
        accountKeyId,
        accountKeyEnvelope: {},
      }),
      loadAccountEncryptionKey: async () => Uint8Array.from(accountKey),
    },
    { request: async () => ({ status: 200, body: { vaults } }) },
  );
}

describe("Server Switch candidate inspection", () => {
  it("classifies an empty Account without writing candidate authority", async () => {
    await expect(inspector([]).inspect(vaultId, rootKey)).resolves.toEqual({ headCursor: 0 });
  });

  it("unwraps and verifies the candidate Root Key and Generation identity", async () => {
    await expect(inspector([await resource()]).inspect(vaultId, rootKey)).resolves.toMatchObject({
      replica: {
        vaultId,
        generation: { generationId, generationNumber: 4 },
      },
      registration: { accountId, accountKeyId, vaultId, deliveryCursor: 17 },
      headCursor: 17,
    });
  });

  it("distinguishes another Vault from a same-ID Root Key integrity failure", async () => {
    const another = { ...(await resource()), vaultId: "01900000-0000-7000-8000-000000000099" };
    await expect(inspector([another]).inspect(vaultId, rootKey)).rejects.toMatchObject({
      id: "SERVER_SWITCH_VAULT_MISMATCH",
    });
    await expect(
      inspector([await resource()]).inspect(vaultId, new Uint8Array(32).fill(8)),
    ).rejects.toMatchObject({ id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
  });

  it("rejects noncanonical cardinality and counters", async () => {
    await expect(
      inspector([await resource(), await resource()]).inspect(vaultId, rootKey),
    ).rejects.toMatchObject({
      id: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
    await expect(
      inspector([{ ...(await resource()), headCursor: -1 }]).inspect(vaultId, rootKey),
    ).rejects.toMatchObject({ id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
  });
});
