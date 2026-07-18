import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../../src/runtime/vault";
import { deepLinkVaultRoute, vaultManagementView } from "../../src/ui/vault-management-view";

const firstVaultId = "00000000-0000-4000-8000-000000000101";
const secondVaultId = "00000000-0000-4000-8000-000000000102";

function workspace(busy = false): WorkspaceState {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    activeVaultId: firstVaultId,
    vaults: [
      {
        vaultId: firstVaultId,
        name: "Amber Archive",
        createdAt: "2026-07-18T12:00:00.000Z",
        active: true,
        unlocked: true,
        manuallyLocked: false,
      },
      {
        vaultId: secondVaultId,
        name: "amber archive",
        createdAt: "2026-07-18T13:00:00.000Z",
        active: false,
        unlocked: false,
        manuallyLocked: true,
      },
    ],
    ...(busy ? { busy: { vaultId: firstVaultId, operation: "Capture" as const } } : {}),
  };
}

describe("shared Vault management view", () => {
  it("labels duplicate names with short IDs and marks the current Vault", () => {
    expect(vaultManagementView(workspace()).options).toEqual([
      expect.objectContaining({
        vaultId: firstVaultId,
        label: "Amber Archive · 000101",
        current: true,
      }),
      expect.objectContaining({
        vaultId: secondVaultId,
        label: "amber archive · 000102",
        current: false,
      }),
    ]);
  });

  it("disables create, select, and rename while the active Vault is busy", () => {
    expect(vaultManagementView(workspace(true))).toMatchObject({
      managementDisabled: true,
      busyText: "Capture in progress",
    });
  });

  it("presents Export as a canonical Vault-wide busy operation", () => {
    expect(
      vaultManagementView({
        ...workspace(),
        busy: { vaultId: firstVaultId, operation: "Export" },
      }),
    ).toMatchObject({ managementDisabled: true, busyText: "Export in progress" });
  });

  it("requires an explicit switch for a deep link naming another Vault", () => {
    expect(deepLinkVaultRoute(firstVaultId, secondVaultId)).toEqual({
      route: "switch-prompt",
      targetVaultId: secondVaultId,
    });
    expect(deepLinkVaultRoute(firstVaultId, firstVaultId)).toEqual({ route: "open" });
  });
});
