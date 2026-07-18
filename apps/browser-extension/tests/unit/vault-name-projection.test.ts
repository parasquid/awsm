import { describe, expect, it } from "vitest";

import {
  reduceVaultNameProjection,
  type VaultNameEventV1,
} from "../../src/runtime/vault/name-projection";

const vaultId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";

function event(
  eventId: string,
  eventType: "VaultCreated" | "VaultRenamed",
  name: string,
  orderingTimestamp: string,
): VaultNameEventV1 {
  return { version: 1, eventId, eventType, vaultId, deviceId, name, orderingTimestamp };
}

describe("Vault Name Projection", () => {
  it("derives the latest name in canonical timestamp and Event-ID order", () => {
    const created = event(
      "00000000-0000-4000-8000-000000000010",
      "VaultCreated",
      "Amber Archive",
      "2026-07-18T10:00:00.000Z",
    );
    const earlierId = event(
      "00000000-0000-4000-8000-000000000011",
      "VaultRenamed",
      "Quiet Folio",
      "2026-07-18T11:00:00.000Z",
    );
    const laterId = event(
      "00000000-0000-4000-8000-000000000012",
      "VaultRenamed",
      "Starlit Chronicle",
      "2026-07-18T11:00:00.000Z",
    );

    expect(reduceVaultNameProjection([laterId, created, earlierId])).toEqual({
      version: 1,
      vaultId,
      name: "Starlit Chronicle",
      sourceEventId: laterId.eventId,
      updatedAt: laterId.orderingTimestamp,
    });
  });

  it("treats duplicate Event IDs as idempotent", () => {
    const created = event(
      "00000000-0000-4000-8000-000000000010",
      "VaultCreated",
      "Amber Archive",
      "2026-07-18T10:00:00.000Z",
    );
    expect(reduceVaultNameProjection([created, created])).toMatchObject({ name: "Amber Archive" });
  });

  it("rejects Rename before Create, duplicate Create, mixed Vaults, and invalid names", () => {
    const created = event(
      "00000000-0000-4000-8000-000000000010",
      "VaultCreated",
      "Amber Archive",
      "2026-07-18T10:00:00.000Z",
    );
    expect(() =>
      reduceVaultNameProjection([
        event(
          "00000000-0000-4000-8000-000000000011",
          "VaultRenamed",
          "Quiet Folio",
          "2026-07-18T09:00:00.000Z",
        ),
      ]),
    ).toThrowError(/before VaultCreated/u);
    expect(() =>
      reduceVaultNameProjection([created, { ...created, eventId: crypto.randomUUID() }]),
    ).toThrowError(/more than once/u);
    expect(() =>
      reduceVaultNameProjection([
        created,
        {
          ...created,
          eventId: crypto.randomUUID(),
          vaultId: crypto.randomUUID(),
          eventType: "VaultRenamed",
        },
      ]),
    ).toThrowError(/same Vault/u);
    expect(() => reduceVaultNameProjection([{ ...created, name: "\u202eunsafe" }])).toThrowError(
      /control/u,
    );
  });
});
