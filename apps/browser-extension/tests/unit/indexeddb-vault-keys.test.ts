import { describe, expect, it } from "vitest";

import { vaultKey, vaultPrefixBounds, vaultSingletonKey } from "../../src/drivers/indexeddb/keys";

const vaultId = "00000000-0000-4000-8000-000000000001";

describe("IndexedDB Vault compound keys", () => {
  it("constructs canonical entity and singleton keys", () => {
    expect(vaultKey(vaultId, "00000000-0000-4000-8000-000000000002")).toEqual([
      vaultId,
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(vaultSingletonKey(vaultId, "active")).toEqual([vaultId, "active"]);
  });

  it("constructs exclusive array bounds that contain every two-part key for one Vault", () => {
    expect(vaultPrefixBounds(vaultId)).toEqual({
      lower: [vaultId],
      upper: [vaultId, []],
      lowerOpen: false,
      upperOpen: true,
    });
  });

  it("rejects empty key components", () => {
    expect(() => vaultKey("", "entity")).toThrowError(/Vault ID/u);
    expect(() => vaultKey(vaultId, "")).toThrowError(/entity ID/u);
  });
});
