import { describe, expect, it } from "vitest";
import type { LibraryItemV1 } from "../../src/domain/contracts";
import {
  type CollectionTopologyEventV1,
  groupCollectionItems,
  resolveCollectionId,
  selectCollectionForCapture,
} from "../../src/runtime/library/collections";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function item(
  bundle: number,
  collection: number,
  originalUrl: string,
  capturedAt: string,
  status: "Active" | "Deleted" = "Active",
): LibraryItemV1 {
  return {
    version: 1,
    bundleId: id(bundle),
    descriptorObjectId: id(bundle + 100),
    assignedCollectionId: id(collection),
    title: `Capture ${String(bundle)}`,
    originalUrl,
    capturedAt,
    artifactRoles: ["PRIMARY"],
    status,
    warnings: [],
  };
}

const merge = (
  event: number,
  destination: number,
  sources: readonly number[],
): CollectionTopologyEventV1 => ({
  eventId: id(event),
  eventType: "CollectionsMerged",
  destinationCollectionId: id(destination),
  sourceCollectionIds: sources.map(id),
});

describe("stable Library Collections", () => {
  it("groups by stable identity and exposes newest-first exact known URLs", () => {
    const older = item(
      1,
      20,
      "https://fixture.test/article?foo=bar#old",
      "2026-07-18T08:00:00.000Z",
    );
    const latest = item(2, 20, "https://mirror.test/story#latest", "2026-07-18T09:00:00.000Z");
    const repeated = item(3, 20, older.originalUrl, "2026-07-18T10:00:00.000Z");

    expect(groupCollectionItems([older, latest, repeated], [], "Active")).toEqual([
      {
        collectionId: id(20),
        title: repeated.title,
        originalUrl: repeated.originalUrl,
        knownUrls: [repeated.originalUrl, latest.originalUrl],
        latest: repeated,
        captures: [repeated, latest, older],
      },
    ]);
  });

  it("merges complete identities across Active and Deleted and can revert the merge", () => {
    const active = item(1, 20, "https://one.test/page", "2026-07-18T08:00:00.000Z");
    const deleted = item(2, 21, "https://two.test/page", "2026-07-18T09:00:00.000Z", "Deleted");
    const merged = merge(40, 20, [21]);

    expect(groupCollectionItems([active, deleted], [merged], "Active")[0]?.collectionId).toBe(
      id(20),
    );
    expect(groupCollectionItems([active, deleted], [merged], "Deleted")[0]?.collectionId).toBe(
      id(20),
    );
    expect(resolveCollectionId(id(21), [merged])).toBe(id(20));

    const reverted: CollectionTopologyEventV1 = {
      eventId: id(41),
      eventType: "CollectionMergeReverted",
      mergeEventId: merged.eventId,
    };
    expect(resolveCollectionId(id(21), [merged, reverted])).toBe(id(21));
    expect(
      groupCollectionItems([active, deleted], [merged, reverted], "Deleted")[0]?.collectionId,
    ).toBe(id(21));
  });

  it("routes only exact fragmentless known URLs and never broadens to a host or query family", () => {
    const items = [
      item(1, 20, "https://one.test/article?foo=bar#old", "2026-07-18T08:00:00.000Z"),
      item(2, 21, "https://mirror.test/story", "2026-07-18T09:00:00.000Z"),
    ];
    const topology = [merge(40, 20, [21])];

    expect(
      selectCollectionForCapture(items, topology, "https://one.test/article?foo=bar#new", () =>
        id(99),
      ),
    ).toBe(id(20));
    expect(
      selectCollectionForCapture(items, topology, "https://mirror.test/story#section", () =>
        id(99),
      ),
    ).toBe(id(20));
    expect(
      selectCollectionForCapture(items, topology, "https://one.test/article?foo=baz", () => id(99)),
    ).toBe(id(99));
    expect(
      selectCollectionForCapture(items, topology, "https://one.test/account", () => id(98)),
    ).toBe(id(98));
  });

  it("uses the newest Active tail, then ascending Collection ID, for ambiguous matches", () => {
    const sameUrl = "https://fixture.test/article";
    const items = [
      item(1, 20, sameUrl, "2026-07-18T08:00:00.000Z"),
      item(2, 21, sameUrl, "2026-07-18T09:00:00.000Z"),
    ];
    expect(selectCollectionForCapture(items, [], sameUrl, () => id(99))).toBe(id(21));

    const tied = [
      item(3, 22, sameUrl, "2026-07-18T10:00:00.000Z"),
      item(4, 23, sameUrl, "2026-07-18T10:00:00.000Z"),
    ];
    expect(selectCollectionForCapture(tied, [], sameUrl, () => id(99))).toBe(id(22));
  });

  it("ignores Deleted-only matches and creates a fresh Collection", () => {
    const deleted = item(
      1,
      20,
      "https://fixture.test/article",
      "2026-07-18T08:00:00.000Z",
      "Deleted",
    );
    expect(selectCollectionForCapture([deleted], [], deleted.originalUrl, () => id(99))).toBe(
      id(99),
    );
  });
});
