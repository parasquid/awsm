import { describe, expect, it } from "vitest";
import { WorkspaceService } from "../../src/runtime/vault/workspace-service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const firstVaultId = "00000000-0000-4000-8000-000000000101";
const secondVaultId = "00000000-0000-4000-8000-000000000102";

describe("WorkspaceService", () => {
  it("returns deterministic summaries without putting names in directory records", async () => {
    const repository = {
      bootstrap: async () => ({
        metadata: {
          version: 1 as const,
          workspaceId,
          createdAt: "2026-07-18T12:00:00.000Z",
          activeVaultId: secondVaultId,
        },
        nameCacheKey: {} as CryptoKey,
      }),
      listVaultDirectory: async () => [
        {
          version: 1 as const,
          vaultId: secondVaultId,
          createdAt: "2026-07-18T12:02:00.000Z",
        },
        {
          version: 1 as const,
          vaultId: firstVaultId,
          createdAt: "2026-07-18T12:01:00.000Z",
        },
      ],
      loadVaultStatus: async (vaultId: string) => ({
        manuallyLocked: vaultId === firstVaultId,
      }),
      readVaultName: async (_key: CryptoKey, _workspace: string, vaultId: string) =>
        vaultId === firstVaultId ? "Quiet Folio" : "amber archive",
    };
    const service = new WorkspaceService(repository, () => "2026-07-18T12:03:00.000Z");

    await expect(service.state({ unlockedVaultId: secondVaultId })).resolves.toEqual({
      workspaceId,
      activeVaultId: secondVaultId,
      vaults: [
        {
          vaultId: secondVaultId,
          name: "amber archive",
          createdAt: "2026-07-18T12:02:00.000Z",
          active: true,
          unlocked: true,
          manuallyLocked: false,
        },
        {
          vaultId: firstVaultId,
          name: "Quiet Folio",
          createdAt: "2026-07-18T12:01:00.000Z",
          active: false,
          unlocked: false,
          manuallyLocked: true,
        },
      ],
    });
    expect(Object.keys((await repository.listVaultDirectory())[0] ?? {})).not.toContain("name");
  });

  it("fails safely when active selection is dangling", async () => {
    const repository = {
      bootstrap: async () => ({
        metadata: {
          version: 1 as const,
          workspaceId,
          createdAt: "2026-07-18T12:00:00.000Z",
          activeVaultId: secondVaultId,
        },
        nameCacheKey: {} as CryptoKey,
      }),
      listVaultDirectory: async () => [
        {
          version: 1 as const,
          vaultId: firstVaultId,
          createdAt: "2026-07-18T12:01:00.000Z",
        },
      ],
      loadVaultStatus: async () => ({ manuallyLocked: true }),
      readVaultName: async () => "Quiet Folio",
    };
    const service = new WorkspaceService(repository, () => "2026-07-18T12:03:00.000Z");
    await expect(service.state({})).rejects.toMatchObject({ id: "STORAGE_TRANSACTION_FAILED" });
  });
});
