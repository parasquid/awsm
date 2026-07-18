import type { WorkspaceState } from "../runtime/vault";
import { vaultNameComparisonKey } from "../runtime/vault/name";

export interface VaultPickerOption {
  readonly vaultId: string;
  readonly label: string;
  readonly name: string;
  readonly createdAt: string;
  readonly current: boolean;
  readonly unlocked: boolean;
}

export interface VaultManagementView {
  readonly activeName?: string;
  readonly activeUnlocked: boolean;
  readonly managementDisabled: boolean;
  readonly busyText?: string;
  readonly options: readonly VaultPickerOption[];
}

function shortId(vaultId: string): string {
  return vaultId.slice(-6);
}

export function vaultManagementView(workspace: WorkspaceState): VaultManagementView {
  const counts = new Map<string, number>();
  for (const vault of workspace.vaults) {
    const key = vaultNameComparisonKey(vault.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const options = workspace.vaults.map((vault): VaultPickerOption => {
    const duplicate = (counts.get(vaultNameComparisonKey(vault.name)) ?? 0) > 1;
    const placeholder = vault.name === `Vault ${shortId(vault.vaultId)}`;
    return {
      vaultId: vault.vaultId,
      label: duplicate || placeholder ? `${vault.name} · ${shortId(vault.vaultId)}` : vault.name,
      name: vault.name,
      createdAt: vault.createdAt,
      current: vault.active,
      unlocked: vault.unlocked,
    };
  });
  const active = workspace.vaults.find((vault) => vault.active);
  const busy = workspace.busy;
  return {
    ...(active === undefined ? {} : { activeName: active.name }),
    activeUnlocked: active?.unlocked === true,
    managementDisabled: busy !== undefined,
    ...(busy === undefined ? {} : { busyText: `${busy.operation} in progress` }),
    options,
  };
}

export type DeepLinkVaultRoute =
  | { readonly route: "open" }
  | { readonly route: "switch-prompt"; readonly targetVaultId: string };

export function deepLinkVaultRoute(
  activeVaultId: string | undefined,
  targetVaultId: string,
): DeepLinkVaultRoute {
  return activeVaultId === targetVaultId
    ? { route: "open" }
    : { route: "switch-prompt", targetVaultId };
}
