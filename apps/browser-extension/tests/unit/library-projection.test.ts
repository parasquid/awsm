import { describe, expect, it } from "vitest";
import { reduceLibraryProjection } from "../../src/runtime/library/projection";

const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "BundleRegistered" as const,
  bundleId: "00000000-0000-4000-8000-000000000002",
  bundleObjectId: "00000000-0000-4000-8000-000000000003",
  title: "Fixture",
  originalUrl: "https://fixture.test/",
  capturedAt: "2026-07-16T17:00:00.000Z",
  screenshotPresent: true,
  warnings: [],
};

describe("Library Projection replay", () => {
  it("does not duplicate a library row when an Event is replayed", () => {
    expect(reduceLibraryProjection([event, event])).toEqual([
      {
        version: 1,
        bundleId: event.bundleId,
        bundleObjectId: event.bundleObjectId,
        title: event.title,
        originalUrl: event.originalUrl,
        capturedAt: event.capturedAt,
        screenshotPresent: true,
        status: "Active",
        warnings: [],
      },
    ]);
  });

  it("uses the first accepted Event when conflicting duplicates share an Event ID", () => {
    expect(
      reduceLibraryProjection([
        event,
        { ...event, title: "Mutated replay", screenshotPresent: false },
      ])[0],
    ).toMatchObject({ title: "Fixture", screenshotPresent: true });
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
});
