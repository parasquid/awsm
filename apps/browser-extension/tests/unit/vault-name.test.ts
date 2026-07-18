import { describe, expect, it } from "vitest";

import {
  normalizeVaultName,
  suggestVaultName,
  vaultNameComparisonKey,
} from "../../src/runtime/vault/name";

describe("Vault names", () => {
  it("normalizes names to NFC with canonical single spaces", () => {
    expect(normalizeVaultName("  Amber    Chron\u0069\u0301cle  ")).toBe("Amber Chronícle");
  });

  it("rejects empty, oversized, control, and bidi-control names", () => {
    expect(() => normalizeVaultName("   ")).toThrowError(/between 1 and 64/u);
    expect(() => normalizeVaultName("a".repeat(65))).toThrowError(/between 1 and 64/u);
    expect(() => normalizeVaultName("Quiet\u0000Folio")).toThrowError(/control/u);
    expect(() => normalizeVaultName("Quiet\nFolio")).toThrowError(/control/u);
    expect(() => normalizeVaultName("Quiet\u202eFolio")).toThrowError(/control/u);
  });

  it("uses a locale-independent case-folded comparison key", () => {
    expect(vaultNameComparisonKey("  AMBER   Chronicle ")).toBe("amber chronicle");
    expect(vaultNameComparisonKey("Ambe\u0301r Folio")).toBe("ambér folio");
  });

  it("generates a preservation-themed suggestion without user-derived input", () => {
    expect(suggestVaultName([], () => 0)).toBe("Amber Archive");
  });

  it("avoids local collisions and uses the smallest suffix after bounded retries", () => {
    expect(suggestVaultName(["amber archive", "Amber Archive 2"], () => 0)).toBe("Amber Archive 3");
  });
});
