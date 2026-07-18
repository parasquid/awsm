import { describe, expect, it } from "vitest";
import type { CaptureMetadataV1 } from "../../src/domain/bundle";
import type { StoredObjectV1, StoredProjectionV1 } from "../../src/drivers/indexeddb";
import { prepareCaptureRegistration } from "../../src/runtime/capture/registration";
import {
  groupLibraryItems,
  type LibraryRepository,
  LibraryService,
} from "../../src/runtime/library/service";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const capturedAt = "2026-07-16T17:00:00.000Z";

async function fixture(): Promise<{
  rootKey: CryptoKey;
  projection: StoredProjectionV1;
  object: StoredObjectV1;
}> {
  const rootKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), "HKDF", false, [
    "deriveBits",
  ]);
  const metadata: CaptureMetadataV1 = {
    version: 1,
    originalUrl: "https://fixture.test/article",
    finalUrl: "https://fixture.test/article",
    title: "Offline fixture",
    capturedAt,
    contentType: "text/html",
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1200 },
    chromeVersion: "149",
    extensionVersion: "0.1.0",
    captureProfileId: "ChromeWebPage-v1",
    captureProfileVersion: 1,
  };
  const registration = await prepareCaptureRegistration({
    rootKey,
    vaultId: id(1),
    deviceId: id(2),
    commandId: id(3),
    bundleId: id(4),
    bundleObjectId: id(5),
    eventId: id(6),
    capturedAt,
    metadata,
    mhtml: new TextEncoder().encode("MIME-Version: 1.0\r\nOffline body"),
    screenshot: new Uint8Array([137, 80, 78, 71]),
    thumbnailPng: new Uint8Array([137, 80, 78, 71, 1]),
    warnings: [],
    clientVersion: "0.1.0",
  });
  return { rootKey, projection: registration.projection, object: registration.object };
}

function repository(projection: StoredProjectionV1, object: StoredObjectV1): LibraryRepository {
  return {
    listEncryptedProjections: async () => [projection],
    getStoredObject: async (objectId) => (objectId === object.objectId ? object : undefined),
  };
}

describe("offline encrypted library", () => {
  it("groups repeated captures of a normalized page URL as newest-first history", () => {
    const item = {
      version: 1 as const,
      bundleId: id(21),
      bundleObjectId: id(22),
      title: "First title",
      originalUrl: "https://fixture.test/article#old-fragment",
      capturedAt: "2026-07-16T16:00:00.000Z",
      screenshotPresent: false,
      status: "Active" as const,
      warnings: [],
    };
    const latest = {
      ...item,
      bundleId: id(23),
      bundleObjectId: id(24),
      title: "Latest title",
      originalUrl: "https://fixture.test/article#new-fragment",
      capturedAt: "2026-07-16T18:00:00.000Z",
      screenshotPresent: true,
    };

    expect(groupLibraryItems([item, latest])).toEqual([
      {
        pageKey: "https://fixture.test/article",
        title: "Latest title",
        originalUrl: latest.originalUrl,
        latest,
        captures: [latest, item],
      },
    ]);
  });
  it("decrypts the list Projection and the validated Bundle detail", async () => {
    const data = await fixture();
    const service = new LibraryService(
      repository(data.projection, data.object),
      data.rootKey,
      id(1),
    );
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        title: "Offline fixture",
        screenshotPresent: true,
        thumbnailPng: new Uint8Array([137, 80, 78, 71, 1]),
      }),
    ]);
    const detail = await service.detail(id(4));
    expect(detail.metadata).toMatchObject({ title: "Offline fixture" });
    expect(detail.screenshot).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(new TextDecoder().decode(detail.mhtml)).toContain("Offline body");
  });

  it("reports corrupt ciphertext without returning partial plaintext", async () => {
    const data = await fixture();
    const bytes = Uint8Array.from(data.object.envelopeBytes);
    const finalByte = bytes.at(-1);
    if (finalByte === undefined) throw new Error("Fixture envelope must not be empty");
    bytes.set([finalByte ^ 1], bytes.length - 1);
    const service = new LibraryService(
      repository(data.projection, { ...data.object, envelopeBytes: bytes }),
      data.rootKey,
      id(1),
    );
    await expect(service.detail(id(4))).rejects.toMatchObject({ id: "BUNDLE_INVALID" });
  });

  it("rejects missing captures with BUNDLE_INVALID", async () => {
    const data = await fixture();
    const service = new LibraryService(
      {
        listEncryptedProjections: async () => [data.projection],
        getStoredObject: async () => undefined,
      },
      data.rootKey,
      id(1),
    );
    await expect(service.detail(id(4))).rejects.toMatchObject({ id: "BUNDLE_INVALID" });
  });
});
