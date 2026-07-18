import { describe, expect, it } from "vitest";
import { decodeEncryptedEnvelopeBytes, decryptEnvelope } from "../../src/crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../src/crypto/hkdf";
import { type CaptureMetadataV1, readBundle } from "../../src/domain/bundle";
import { decodeCanonicalCbor } from "../../src/domain/cbor";
import { prepareCaptureRegistration } from "../../src/runtime/capture/registration";

const vaultId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const bundleId = "00000000-0000-4000-8000-000000000003";
const bundleObjectId = "00000000-0000-4000-8000-000000000004";
const eventId = "00000000-0000-4000-8000-000000000005";
const commandId = "00000000-0000-4000-8000-000000000006";
const capturedAt = "2026-07-16T17:00:00.000Z";

const metadata: CaptureMetadataV1 = {
  version: 1,
  originalUrl: "https://private.example/article",
  finalUrl: "https://private.example/final",
  title: "Private page title",
  capturedAt,
  contentType: "text/html",
  viewport: { width: 800, height: 600 },
  document: { width: 800, height: 1200 },
  chromeVersion: "149.0.0.0",
  extensionVersion: "0.1.0",
  captureProfileId: "ChromeWebPage-v1",
  captureProfileVersion: 1,
};

async function rootKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(32).fill(9), "HKDF", false, ["deriveBits"]);
}

describe("encrypted capture registration", () => {
  it("builds and validates the Bundle before creating four encrypted commit records", async () => {
    const key = await rootKey();
    const registration = await prepareCaptureRegistration({
      rootKey: key,
      vaultId,
      deviceId,
      commandId,
      bundleId,
      bundleObjectId,
      eventId,
      capturedAt,
      metadata,
      mhtml: new TextEncoder().encode("MIME-Version: 1.0\r\nSecret body"),
      screenshot: new Uint8Array([137, 80, 78, 71]),
      thumbnailPng: new Uint8Array([137, 80, 78, 71, 1]),
      warnings: [],
      clientVersion: "0.1.0",
    });
    expect(registration.outcome).toEqual({
      version: 1,
      commandId,
      status: "Succeeded",
      bundleId,
      bundleObjectId,
      eventId,
    });

    const bundleEnvelope = decodeEncryptedEnvelopeBytes(registration.object.envelopeBytes);
    const bundleKey = await deriveContextKeyFromCryptoKey(key, {
      vaultId,
      domain: "vault:bundle:v1",
      contextId: bundleId,
      keyVersion: 1,
    });
    const bundle = await readBundle(await decryptEnvelope(bundleEnvelope, bundleKey));
    expect(bundle.metadata).toMatchObject({ title: "Private page title" });
    expect(bundle.artifacts.get("PRIMARY")).toContain(new TextEncoder().encode("Secret body")[0]);

    const eventKey = await deriveContextKeyFromCryptoKey(key, {
      vaultId,
      domain: "vault:event:v1",
      contextId: eventId,
      keyVersion: 1,
    });
    expect(
      decodeCanonicalCbor(
        await decryptEnvelope(
          decodeEncryptedEnvelopeBytes(registration.event.envelopeBytes),
          eventKey,
        ),
      ),
    ).toMatchObject({
      eventType: "BundleRegistered",
      correlationId: commandId,
      bundleId,
    });

    const projectionKey = await deriveContextKeyFromCryptoKey(key, {
      vaultId,
      domain: "vault:projection:v1",
      contextId: `LibraryItem-v1:${bundleId}`,
      keyVersion: 1,
    });
    expect(
      decodeCanonicalCbor(
        await decryptEnvelope(
          decodeEncryptedEnvelopeBytes(registration.projection.envelopeBytes),
          projectionKey,
        ),
      ),
    ).toMatchObject({
      title: "Private page title",
      screenshotPresent: true,
      thumbnailPng: new Uint8Array([137, 80, 78, 71, 1]),
    });
  });

  it("does not expose URL, title, MHTML, or screenshot bytes in persisted records", async () => {
    const registration = await prepareCaptureRegistration({
      rootKey: await rootKey(),
      vaultId,
      deviceId,
      commandId,
      bundleId,
      bundleObjectId,
      eventId,
      capturedAt,
      metadata,
      mhtml: new TextEncoder().encode("UNIQUE_MHTML_SECRET"),
      screenshot: new TextEncoder().encode("UNIQUE_SCREENSHOT_SECRET"),
      thumbnailPng: new TextEncoder().encode("UNIQUE_THUMBNAIL_SECRET"),
      warnings: ["OPTIONAL_METADATA_UNAVAILABLE"],
      clientVersion: "0.1.0",
    });
    const persisted = [
      registration.object.envelopeBytes,
      registration.event.envelopeBytes,
      registration.projection.envelopeBytes,
    ];
    for (const bytes of persisted) {
      const encoded = new TextDecoder().decode(bytes);
      expect(encoded).not.toContain("private.example");
      expect(encoded).not.toContain("Private page title");
      expect(encoded).not.toContain("UNIQUE_MHTML_SECRET");
      expect(encoded).not.toContain("UNIQUE_SCREENSHOT_SECRET");
      expect(encoded).not.toContain("UNIQUE_THUMBNAIL_SECRET");
    }
  });
});
