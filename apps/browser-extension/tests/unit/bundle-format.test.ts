import { createHash } from "node:crypto";

import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildBundle, readBundle } from "../../src/domain/bundle";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../src/domain/cbor";
import { createDeterministicZip } from "../../src/domain/zip";

const textEncoder = new TextEncoder();

const BUNDLE_ID = "00000000-0000-4000-8000-000000000003";

function requiredEntry(entries: Readonly<Record<string, Uint8Array>>, path: string): Uint8Array {
  const entry = entries[path];
  if (entry === undefined) {
    throw new Error(`Missing test ZIP entry: ${path}`);
  }
  return entry;
}

function bundleInput() {
  return {
    bundleId: BUNDLE_ID,
    createdAt: "2026-07-16T17:00:00.000Z",
    clientVersion: "0.1.0",
    metadata: {
      version: 1,
      originalUrl: "https://example.test/article",
      finalUrl: "https://example.test/article",
      title: "A durable example",
      capturedAt: "2026-07-16T17:00:00.000Z",
      contentType: "text/html",
      viewport: { width: 1280, height: 720 },
      document: { width: 1280, height: 2400 },
      chromeVersion: "126.0.0.0",
      extensionVersion: "0.1.0",
      captureProfileId: "ChromeWebPage-v1",
      captureProfileVersion: 1,
    },
    mhtml: textEncoder.encode("MIME-Version: 1.0\r\nContent-Type: multipart/related"),
  } as const;
}

describe("canonical Bundle serialization", () => {
  it("encodes RFC 8949 canonical CBOR independently of insertion order", () => {
    const first = encodeCanonicalCbor({ b: 2, a: 1 });
    const second = encodeCanonicalCbor({ a: 1, b: 2 });

    expect(first).toEqual(second);
    expect(Buffer.from(first).toString("hex")).toBe("a2616101616202");
    expect(decodeCanonicalCbor(first)).toEqual({ a: 1, b: 2 });
  });

  it("produces the fixed deterministic ZIP golden bytes", () => {
    const bytes = createDeterministicZip({
      "z.txt": textEncoder.encode("z"),
      "a.txt": textEncoder.encode("a"),
    });

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "05457881f9d759d69a8e76b7910dd142ff9274e4e2aed28d8ee60f7d90e3e696",
    );
    expect(Object.keys(unzipSync(bytes))).toEqual(["a.txt", "z.txt"]);
  });

  it("builds byte-identical Bundles for identical logical inputs", async () => {
    const first = await buildBundle(bundleInput());
    const second = await buildBundle(bundleInput());

    expect(first.bytes).toEqual(second.bytes);
    expect(first.manifest.artifacts.map((artifact) => artifact.path)).toEqual([
      "artifacts/primary.mhtml",
    ]);

    const entries = unzipSync(first.bytes);
    expect(Object.keys(entries)).toEqual([
      "artifacts/primary.mhtml",
      "manifest.cbor",
      "metadata.cbor",
    ]);
  });

  it("round-trips and validates a Bundle with an optional screenshot", async () => {
    const built = await buildBundle({
      ...bundleInput(),
      screenshot: new Uint8Array([137, 80, 78, 71]),
    });
    const read = await readBundle(built.bytes);

    expect(read.manifest.artifacts.map((artifact) => artifact.role)).toEqual([
      "PRIMARY",
      "SCREENSHOT_FULL",
    ]);
    expect(read.metadata).toMatchObject({
      title: "A durable example",
      originalUrl: "https://example.test/article",
    });
    expect(read.artifacts.get("PRIMARY")).toEqual(bundleInput().mhtml);
    expect(read.artifacts.get("SCREENSHOT_FULL")).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("rejects Artifact bytes changed after Manifest creation", async () => {
    const built = await buildBundle(bundleInput());
    const entries = unzipSync(built.bytes);
    const original = requiredEntry(entries, "artifacts/primary.mhtml");
    entries["artifacts/primary.mhtml"] = new Uint8Array(original.byteLength).fill(1);
    const tampered = zipSync(
      {
        "artifacts/primary.mhtml": requiredEntry(entries, "artifacts/primary.mhtml"),
        "manifest.cbor": requiredEntry(entries, "manifest.cbor"),
        "metadata.cbor": requiredEntry(entries, "metadata.cbor"),
      },
      { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0, 0) },
    );

    await expect(readBundle(tampered)).rejects.toThrow("checksum");
  });
});
