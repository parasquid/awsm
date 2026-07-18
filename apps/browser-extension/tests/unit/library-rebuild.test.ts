import { describe, expect, it } from "vitest";
import type { CaptureMetadataV1 } from "../../src/domain/bundle";
import type {
  StoredCollectionProjectionV1,
  StoredEventV1,
  StoredProjectionV1,
} from "../../src/drivers/indexeddb";
import { prepareCaptureRegistration } from "../../src/runtime/capture/registration";
import {
  planCollectionMerge,
  prepareCollectionOperation,
} from "../../src/runtime/library/management";
import { LibraryProjectionRebuilder } from "../../src/runtime/library/rebuild";
import { LibraryService } from "../../src/runtime/library/service";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(32).fill(4), "HKDF", false, ["deriveBits"]);
}

function metadata(bundle: number, capturedAt: string): CaptureMetadataV1 {
  return {
    version: 1,
    originalUrl: `https://fixture.test/article?version=${String(bundle)}`,
    finalUrl: `https://fixture.test/article?version=${String(bundle)}`,
    title: `Capture ${String(bundle)}`,
    capturedAt,
    contentType: "text/html",
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1200 },
    chromeVersion: "149",
    extensionVersion: "0.1.0",
    captureProfileId: "ChromeWebPage-v1",
    captureProfileVersion: 1,
  };
}

describe("Library Projection rebuild", () => {
  it("rebuilds stable assignments and merge topology from encrypted Events", async () => {
    const rootKey = await key();
    const vaultId = id(1);
    const firstMetadata = metadata(10, "2026-07-18T10:00:00.000Z");
    const secondMetadata = metadata(20, "2026-07-18T11:00:00.000Z");
    const first = await prepareCaptureRegistration({
      rootKey,
      vaultId,
      deviceId: id(2),
      commandId: id(3),
      bundleId: id(10),
      bundleObjectId: id(11),
      eventId: id(12),
      collectionId: id(30),
      capturedAt: firstMetadata.capturedAt,
      metadata: firstMetadata,
      mhtml: new TextEncoder().encode("MIME-Version: 1.0\r\nFirst"),
      warnings: ["SCREENSHOT_UNAVAILABLE"],
      clientVersion: "0.1.0",
    });
    const second = await prepareCaptureRegistration({
      rootKey,
      vaultId,
      deviceId: id(2),
      commandId: id(4),
      bundleId: id(20),
      bundleObjectId: id(21),
      eventId: id(22),
      collectionId: id(31),
      capturedAt: secondMetadata.capturedAt,
      metadata: secondMetadata,
      mhtml: new TextEncoder().encode("MIME-Version: 1.0\r\nSecond"),
      warnings: ["SCREENSHOT_UNAVAILABLE"],
      clientVersion: "0.1.0",
    });
    const serviceBefore = new LibraryService(
      {
        listEncryptedProjections: async () => [first.projection, second.projection],
        getCollectionProjection: async () => undefined,
        getStoredObject: async () => undefined,
      },
      rootKey,
      vaultId,
    );
    const items = await serviceBefore.list();
    const merge = planCollectionMerge(items, [], id(30), [id(31)], id(40));
    const preparedMerge = await prepareCollectionOperation({
      rootKey,
      vaultId,
      deviceId: id(2),
      eventId: merge.eventId,
      timestamp: "2026-07-18T12:00:00.000Z",
      items,
      topology: [],
      fact: merge,
    });
    const events: StoredEventV1[] = [first.event, second.event, preparedMerge.event];
    let rebuiltItems: readonly StoredProjectionV1[] = [];
    let rebuiltCollections: StoredCollectionProjectionV1 | undefined;
    await new LibraryProjectionRebuilder(
      {
        listStoredEvents: async () => events,
        replaceLibraryProjections: async (itemProjections, collectionProjection) => {
          rebuiltItems = itemProjections;
          rebuiltCollections = collectionProjection;
        },
      },
      rootKey,
      vaultId,
    ).execute();

    const rebuilt = new LibraryService(
      {
        listEncryptedProjections: async () => rebuiltItems,
        getCollectionProjection: async () => rebuiltCollections,
        getStoredObject: async () => undefined,
      },
      rootKey,
      vaultId,
    );
    await expect(rebuilt.list()).resolves.toHaveLength(2);
    await expect(rebuilt.groups()).resolves.toEqual([
      expect.objectContaining({
        collectionId: id(30),
        captures: [
          expect.objectContaining({ bundleId: id(20), assignedCollectionId: id(31) }),
          expect.objectContaining({ bundleId: id(10), assignedCollectionId: id(30) }),
        ],
      }),
    ]);
  });
});
