import { describe, expect, it } from "vitest";

import {
  createWorkspaceNameCacheKey,
  decryptWorkspaceVaultName,
  encryptWorkspaceVaultName,
} from "../../src/runtime/vault/workspace-name-cache";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const vaultId = "00000000-0000-4000-8000-000000000002";
const sourceEventId = "00000000-0000-4000-8000-000000000003";

describe("Workspace Vault name cache", () => {
  it("uses a non-exportable local key and round-trips a normalized name", async () => {
    const key = await createWorkspaceNameCacheKey();
    expect(key.extractable).toBe(false);

    const cache = await encryptWorkspaceVaultName({
      key,
      workspaceId,
      vaultId,
      sourceEventId,
      name: "Amber Archive",
    });

    expect(cache).toMatchObject({ version: 1, vaultId, sourceEventId });
    expect(new TextDecoder().decode(cache.ciphertext)).not.toContain("Amber Archive");
    await expect(decryptWorkspaceVaultName(key, workspaceId, cache)).resolves.toBe("Amber Archive");
  });

  it("fails authentication when the Vault binding or ciphertext is changed", async () => {
    const key = await createWorkspaceNameCacheKey();
    const cache = await encryptWorkspaceVaultName({
      key,
      workspaceId,
      vaultId,
      sourceEventId,
      name: "Quiet Folio",
    });

    await expect(
      decryptWorkspaceVaultName(key, workspaceId, { ...cache, vaultId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      decryptWorkspaceVaultName(key, workspaceId, {
        ...cache,
        ciphertext: cache.ciphertext.map((byte, index) => (index === 0 ? byte ^ 1 : byte)),
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
