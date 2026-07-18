export type VaultCompoundKey = [vaultId: string, entityId: string];

export interface VaultPrefixBounds {
  readonly lower: [string];
  readonly upper: [string, []];
  readonly lowerOpen: false;
  readonly upperOpen: true;
}

export function vaultKey(vaultId: string, entityId: string): VaultCompoundKey {
  if (vaultId.length === 0) throw new Error("Vault ID must not be empty.");
  if (entityId.length === 0) throw new Error("The Vault entity ID must not be empty.");
  return [vaultId, entityId];
}

export function vaultSingletonKey(vaultId: string, singleton: string): VaultCompoundKey {
  return vaultKey(vaultId, singleton);
}

export function vaultPrefixBounds(vaultId: string): VaultPrefixBounds {
  if (vaultId.length === 0) throw new Error("Vault ID must not be empty.");
  return {
    lower: [vaultId],
    upper: [vaultId, []],
    lowerOpen: false,
    upperOpen: true,
  };
}

export function vaultKeyRange(vaultId: string): IDBKeyRange {
  const bounds = vaultPrefixBounds(vaultId);
  return IDBKeyRange.bound(bounds.lower, bounds.upper, bounds.lowerOpen, bounds.upperOpen);
}
