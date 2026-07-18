import { describe, expect, it } from "vitest";
import type { LibraryItemV1 } from "../../src/domain/contracts";
import { selectLibraryItems } from "../../src/runtime/library/lifecycle";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function item(suffix: number, status: "Active" | "Deleted"): LibraryItemV1 {
  return {
    version: 1,
    bundleId: id(suffix),
    descriptorObjectId: id(suffix + 100),
    assignedCollectionId: id(suffix + 200),
    title: `Capture ${String(suffix)}`,
    originalUrl: "https://fixture.test/",
    capturedAt: "2026-07-18T00:00:00.000Z",
    artifactRoles: ["PRIMARY"],
    status,
    warnings: [],
  };
}

describe("Library lifecycle selection", () => {
  const active = item(1, "Active");
  const deleted = item(2, "Deleted");

  it("sorts an explicit collection snapshot deterministically", () => {
    const second = item(3, "Active");
    expect(
      selectLibraryItems([active, second], [second.bundleId, active.bundleId], "Active"),
    ).toEqual([active, second]);
  });

  it.each([
    { label: "empty", ids: [] as string[], expected: "Active" as const },
    { label: "duplicate", ids: [active.bundleId, active.bundleId], expected: "Active" as const },
    { label: "missing", ids: [id(99)], expected: "Active" as const },
    { label: "contradictory", ids: [deleted.bundleId], expected: "Active" as const },
  ])("rejects a $label selection without returning a partial snapshot", ({ ids, expected }) => {
    expect(() => selectLibraryItems([active, deleted], ids, expected)).toThrow();
  });
});
