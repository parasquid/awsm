import { describe, expect, it } from "vitest";
import {
  collectionLayerBundleIds,
  formatByteSize,
  libraryGroupDestination,
  libraryStateConfirmation,
} from "../../src/ui/library-view";

const capture = (suffix: string) => ({ bundleId: `00000000-0000-4000-8000-${suffix}` });

describe("Library collection navigation", () => {
  it("formats retained and reclaimable storage in readable binary units", () => {
    expect(formatByteSize(824)).toBe("824 B");
    expect(formatByteSize(12_697)).toBe("12.4 KiB");
    expect(formatByteSize(3_250_586)).toBe("3.1 MiB");
  });
  it("opens a single capture directly without an intermediate history view", () => {
    expect(libraryGroupDestination({ captures: [capture("000000000001")] })).toEqual({
      screen: "detail",
      bundleId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("opens history and layers actual newest capture thumbnails for a collection", () => {
    const captures = [
      capture("000000000003"),
      capture("000000000002"),
      capture("000000000001"),
      capture("000000000000"),
    ];
    expect(libraryGroupDestination({ captures })).toEqual({ screen: "history" });
    expect(collectionLayerBundleIds({ captures })).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("describes deletion as restorable until explicit Vault Vacuum", () => {
    expect(libraryStateConfirmation("A useful page", 2, "Delete")).toBe(
      "Delete “A useful page” (2 captures)?\n\n" +
        "Deleted captures remain accessible and restorable in Deleted.\n\n" +
        "They continue using storage until you run Vault Vacuum.",
    );
  });
});
