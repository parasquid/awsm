import { normalizeVaultName } from "./name";

export interface VaultNameEventV1 {
  readonly version: 1;
  readonly eventId: string;
  readonly eventType: "VaultCreated" | "VaultRenamed";
  readonly vaultId: string;
  readonly deviceId: string;
  readonly name: string;
  readonly orderingTimestamp: string;
}

export interface VaultNameProjectionV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly name: string;
  readonly sourceEventId: string;
  readonly updatedAt: string;
}

function sameEvent(left: VaultNameEventV1, right: VaultNameEventV1): boolean {
  return (
    left.version === right.version &&
    left.eventId === right.eventId &&
    left.eventType === right.eventType &&
    left.vaultId === right.vaultId &&
    left.deviceId === right.deviceId &&
    left.name === right.name &&
    left.orderingTimestamp === right.orderingTimestamp
  );
}

export function reduceVaultNameProjection(
  input: readonly VaultNameEventV1[],
): VaultNameProjectionV1 {
  const byId = new Map<string, VaultNameEventV1>();
  for (const candidate of input) {
    const existing = byId.get(candidate.eventId);
    if (existing !== undefined) {
      if (!sameEvent(existing, candidate)) {
        throw new Error("A duplicate Vault name Event ID has conflicting content.");
      }
      continue;
    }
    if (normalizeVaultName(candidate.name) !== candidate.name) {
      throw new Error("Vault name Events must contain a canonical normalized name.");
    }
    byId.set(candidate.eventId, candidate);
  }
  const events = [...byId.values()].toSorted(
    (left, right) =>
      left.orderingTimestamp.localeCompare(right.orderingTimestamp) ||
      left.eventId.localeCompare(right.eventId),
  );
  const first = events[0];
  if (first === undefined || first.eventType !== "VaultCreated") {
    throw new Error("VaultRenamed cannot be replayed before VaultCreated.");
  }
  const vaultId = first.vaultId;
  let current = first;
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.vaultId !== vaultId) {
      throw new Error("Vault name Events must belong to the same Vault.");
    }
    if (event.eventType === "VaultCreated") {
      throw new Error("VaultCreated cannot occur more than once.");
    }
    current = event;
  }
  return {
    version: 1,
    vaultId,
    name: current.name,
    sourceEventId: current.eventId,
    updatedAt: current.orderingTimestamp,
  };
}
