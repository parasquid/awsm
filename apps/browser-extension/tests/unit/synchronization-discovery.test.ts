import { describe, expect, it } from "vitest";
import { createAccountVaultSlot } from "../../src/runtime/account/crypto";
import { bytesToBase64Url } from "../../src/runtime/account/wire";
import { AccountVaultDiscovery } from "../../src/runtime/synchronization/discovery";

const accountId = "01900000-0000-7000-8000-000000000001";
const accountKeyId = "01900000-0000-7000-8000-000000000002";
const vaultId = "01900000-0000-7000-8000-000000000003";
const generationId = "01900000-0000-7000-8000-000000000004";

async function remoteVault(root = new Uint8Array(32).fill(7)) {
  const accountEncryptionKey = new Uint8Array(32).fill(3);
  const slot = await createAccountVaultSlot({
    slotId: "01900000-0000-7000-8000-000000000005",
    vaultId,
    accountKeyId,
    accountEncryptionKey,
    vaultRootKey: root,
    nonce: new Uint8Array(24).fill(9),
  });
  return {
    accountEncryptionKey,
    resource: {
      vaultId,
      state: "Active",
      generationId,
      generationNumber: 2,
      headCursor: 17,
      accountSlot: {
        ...slot,
        nonce: bytesToBase64Url(slot.nonce),
        ciphertext: bytesToBase64Url(slot.ciphertext),
      },
    },
  };
}

describe("Account Vault discovery", () => {
  it("persists an empty-Account completion job without inventing a Vault", async () => {
    const saved: unknown[] = [];
    const discovery = new AccountVaultDiscovery(
      {
        loadMetadata: async () => ({
          version: 1,
          accountId,
          sessionId: accountId,
          email: "a@b.test",
          accountKeyId,
          accountKeyEnvelope: {},
        }),
        loadAccountEncryptionKey: async () => new Uint8Array(32).fill(3),
        loadAccountVault: async () => undefined,
        saveDiscoveredVault: async (value) => {
          saved.push(value);
        },
      },
      { hasVaultCollision: async () => false, loadLocalReplica: async () => undefined },
      { request: async () => ({ status: 200, body: { vaults: [] } }) },
    );

    const job = await discovery.run("2026-07-19T12:00:00.000Z");

    expect(job).toMatchObject({
      stage: "DiscoverAccountVault",
      state: "Waiting",
      errorId: "ACCOUNT_VAULT_SELECTION_REQUIRED",
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ job });
  });

  it("records a remote-only Vault for Complete Replica download", async () => {
    const remote = await remoteVault();
    let saved:
      | Parameters<ConstructorParameters<typeof AccountVaultDiscovery>[0]["saveDiscoveredVault"]>[0]
      | undefined;
    const discovery = new AccountVaultDiscovery(
      {
        loadMetadata: async () => ({
          version: 1,
          accountId,
          sessionId: accountId,
          email: "a@b.test",
          accountKeyId,
          accountKeyEnvelope: {},
        }),
        loadAccountEncryptionKey: async () => remote.accountEncryptionKey,
        loadAccountVault: async () => undefined,
        saveDiscoveredVault: async (value) => {
          saved = value;
        },
      },
      { hasVaultCollision: async () => false, loadLocalReplica: async () => undefined },
      { request: async () => ({ status: 200, body: { vaults: [remote.resource] } }) },
    );

    const job = await discovery.run("2026-07-19T12:00:00.000Z");

    expect(job).toMatchObject({
      vaultId,
      generationId,
      generationNumber: 2,
      snapshotCursor: 17,
      stage: "DownloadRecords",
      state: "Running",
    });
    expect(saved?.registration).toMatchObject({ accountId, accountKeyId, vaultId });
  });

  it("rejects a same-ID Root Key mismatch before persisting discovery", async () => {
    const remote = await remoteVault();
    let writes = 0;
    const discovery = new AccountVaultDiscovery(
      {
        loadMetadata: async () => ({
          version: 1,
          accountId,
          sessionId: accountId,
          email: "a@b.test",
          accountKeyId,
          accountKeyEnvelope: {},
        }),
        loadAccountEncryptionKey: async () => remote.accountEncryptionKey,
        loadAccountVault: async () => undefined,
        saveDiscoveredVault: async () => {
          writes += 1;
        },
      },
      {
        hasVaultCollision: async () => true,
        loadLocalReplica: async () => ({
          rootKey: new Uint8Array(32).fill(8),
          generationId,
          generationNumber: 2,
        }),
      },
      { request: async () => ({ status: 200, body: { vaults: [remote.resource] } }) },
    );

    await expect(discovery.run()).rejects.toMatchObject({ id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
    expect(writes).toBe(0);
  });

  it("persists an explicit stale-Replica conflict when the server Generation advanced", async () => {
    const remote = await remoteVault();
    let saved:
      | Parameters<ConstructorParameters<typeof AccountVaultDiscovery>[0]["saveDiscoveredVault"]>[0]
      | undefined;
    const discovery = new AccountVaultDiscovery(
      {
        loadMetadata: async () => ({
          version: 1,
          accountId,
          sessionId: accountId,
          email: "a@b.test",
          accountKeyId,
          accountKeyEnvelope: {},
        }),
        loadAccountEncryptionKey: async () => remote.accountEncryptionKey,
        loadAccountVault: async () => undefined,
        saveDiscoveredVault: async (value) => {
          saved = value;
        },
      },
      {
        hasVaultCollision: async () => true,
        loadLocalReplica: async () => ({
          rootKey: new Uint8Array(32).fill(7),
          generationId: "01900000-0000-7000-8000-000000000099",
          generationNumber: 1,
        }),
      },
      { request: async () => ({ status: 200, body: { vaults: [remote.resource] } }) },
    );

    await expect(discovery.run()).resolves.toMatchObject({
      state: "Conflict",
      errorId: "SYNCHRONIZATION_CONFLICT",
      generationId,
    });
    expect(saved?.registration).toMatchObject({ vaultId, remoteGenerationId: generationId });
  });
});
