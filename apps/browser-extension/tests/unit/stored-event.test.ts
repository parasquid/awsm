import { describe, expect, it } from "vitest";

import { decodeStoredEvent } from "../../src/drivers/indexeddb/decode";

const vaultId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const objectId = "00000000-0000-4000-8000-000000000003";

describe("Stored Event", () => {
  it("decodes a Vault-bound canonical dependency list", () => {
    expect(
      decodeStoredEvent({
        version: 1,
        vaultId,
        eventId,
        referencedObjectIds: [objectId],
        orderingTimestamp: "2026-07-18T12:00:00.000Z",
        envelopeBytes: new Uint8Array([1]),
      }),
    ).toEqual({
      version: 1,
      vaultId,
      eventId,
      referencedObjectIds: [objectId],
      orderingTimestamp: "2026-07-18T12:00:00.000Z",
      envelopeBytes: new Uint8Array([1]),
    });
  });

  it("allows Vault lifecycle Events with no Object dependency", () => {
    expect(
      decodeStoredEvent({
        version: 1,
        vaultId,
        eventId,
        referencedObjectIds: [],
        orderingTimestamp: "2026-07-18T12:00:00.000Z",
        envelopeBytes: new Uint8Array([1]),
      }).referencedObjectIds,
    ).toEqual([]);
  });

  it("rejects v1, duplicate, and non-canonical dependency lists", () => {
    const base = {
      version: 1,
      vaultId,
      eventId,
      orderingTimestamp: "2026-07-18T12:00:00.000Z",
      envelopeBytes: new Uint8Array([1]),
    };
    expect(() =>
      decodeStoredEvent({ ...base, version: 99, referencedObjectIds: [objectId] }),
    ).toThrowError(/version/u);
    expect(() =>
      decodeStoredEvent({ ...base, referencedObjectIds: [objectId, objectId] }),
    ).toThrowError(/canonical/u);
    expect(() =>
      decodeStoredEvent({ ...base, referencedObjectIds: [crypto.randomUUID(), objectId] }),
    ).toThrowError(/canonical/u);
  });
});
