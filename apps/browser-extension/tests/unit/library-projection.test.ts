import { describe, expect, it } from "vitest";
import { reduceLibraryProjection } from "../../src/runtime/library/projection";

const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "BundleRegistered" as const,
  bundleId: "00000000-0000-4000-8000-000000000002",
  descriptorObjectId: "00000000-0000-4000-8000-000000000003",
  collectionId: "00000000-0000-4000-8000-000000000020",
  title: "Fixture",
  originalUrl: "https://fixture.test/",
  capturedAt: "2026-07-16T17:00:00.000Z",
  artifactRoles: ["PRIMARY", "SCREENSHOT_FULL"] as const,
  warnings: [],
};

describe("Library Projection replay", () => {
  it("does not duplicate a library row when an Event is replayed", () => {
    expect(reduceLibraryProjection([event, event])).toEqual([
      {
        version: 1,
        bundleId: event.bundleId,
        descriptorObjectId: event.descriptorObjectId,
        assignedCollectionId: event.collectionId,
        title: event.title,
        originalUrl: event.originalUrl,
        capturedAt: event.capturedAt,
        artifactRoles: ["PRIMARY", "SCREENSHOT_FULL"],
        status: "Active",
        warnings: [],
      },
    ]);
  });

  it("uses the first accepted Event when conflicting duplicates share an Event ID", () => {
    expect(
      reduceLibraryProjection([
        event,
        { ...event, title: "Mutated replay", artifactRoles: ["PRIMARY"] },
      ])[0],
    ).toMatchObject({ title: "Fixture", artifactRoles: ["PRIMARY", "SCREENSHOT_FULL"] });
  });

  it("moves explicit captures to Deleted and restores them through additive Events", () => {
    expect(
      reduceLibraryProjection([
        event,
        {
          ...event,
          eventId: "00000000-0000-4000-8000-000000000004",
          bundleId: "00000000-0000-4000-8000-000000000005",
        },
        {
          eventId: "00000000-0000-4000-8000-000000000006",
          eventType: "CapturesDeleted",
          bundleIds: [event.bundleId, "00000000-0000-4000-8000-000000000005"],
        },
        {
          eventId: "00000000-0000-4000-8000-000000000007",
          eventType: "CapturesRestored",
          bundleIds: [event.bundleId],
        },
      ]),
    ).toEqual([
      expect.objectContaining({ bundleId: event.bundleId, status: "Active" }),
      expect.objectContaining({
        bundleId: "00000000-0000-4000-8000-000000000005",
        status: "Deleted",
      }),
    ]);
  });

  it("leaves a later same-page capture Active after deleting a collection snapshot", () => {
    const secondBundleId = "00000000-0000-4000-8000-000000000005";
    const laterBundleId = "00000000-0000-4000-8000-000000000008";
    const result = reduceLibraryProjection([
      event,
      { ...event, eventId: "00000000-0000-4000-8000-000000000004", bundleId: secondBundleId },
      {
        eventId: "00000000-0000-4000-8000-000000000006",
        eventType: "CapturesDeleted",
        bundleIds: [event.bundleId, secondBundleId],
      },
      { ...event, eventId: "00000000-0000-4000-8000-000000000007", bundleId: laterBundleId },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ bundleId: event.bundleId, status: "Deleted" }),
      expect.objectContaining({ bundleId: secondBundleId, status: "Deleted" }),
      expect.objectContaining({ bundleId: laterBundleId, status: "Active" }),
    ]);
  });

  it("moves captures between assigned Collection identities through additive Events", () => {
    const destination = "00000000-0000-4000-8000-000000000030";
    const result = reduceLibraryProjection([
      event,
      {
        eventId: "00000000-0000-4000-8000-000000000031",
        eventType: "CapturesMoved",
        moves: [
          {
            bundleId: event.bundleId,
            fromCollectionId: event.collectionId,
            toCollectionId: destination,
          },
        ],
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        bundleId: event.bundleId,
        assignedCollectionId: destination,
      }),
    ]);
  });

  it("ignores a move whose recorded prior assignment does not match replay state", () => {
    const result = reduceLibraryProjection([
      event,
      {
        eventId: "00000000-0000-4000-8000-000000000032",
        eventType: "CapturesMoved",
        moves: [
          {
            bundleId: event.bundleId,
            fromCollectionId: "00000000-0000-4000-8000-000000000099",
            toCollectionId: "00000000-0000-4000-8000-000000000030",
          },
        ],
      },
    ]);

    expect(result[0]?.assignedCollectionId).toBe(event.collectionId);
  });
});
