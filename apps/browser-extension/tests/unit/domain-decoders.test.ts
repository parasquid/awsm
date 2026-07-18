import { describe, expect, it } from "vitest";

import {
  decodeBundleManifest,
  decodeCaptureJob,
  decodeCapturePageCommand,
  decodeEncryptedEnvelope,
  decodeLibraryItem,
  decodeRuntimeError,
} from "../../src/domain/decode";
import { DomainValidationError } from "../../src/domain/errors";

const IDS = {
  artifact: "A000001",
  bundle: "00000000-0000-4000-8000-000000000003",
  command: "00000000-0000-4000-8000-000000000001",
  device: "00000000-0000-4000-8000-000000000002",
  object: "00000000-0000-4000-8000-000000000005",
} as const;

function validCommand(): Record<string, unknown> {
  return {
    commandId: IDS.command,
    commandType: "CapturePage",
    commandVersion: 1,
    issuingDeviceId: IDS.device,
    createdAt: "2026-07-16T17:00:00.000Z",
    tabId: 42,
    observedUrl: "https://example.test/article",
    captureProfileId: "ChromeWebPage-v1",
    idempotencyKey: IDS.command,
  };
}

function validManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    bundleVersion: 1,
    artifactSchemaVersion: 1,
    bundleId: IDS.bundle,
    createdAt: "2026-07-16T17:00:00.000Z",
    clientVersion: "0.1.0",
    captureProfileId: "ChromeWebPage-v1",
    captureAdapterVersion: 1,
    bundleSerialization: "bundle:zip:v1",
    manifestSerialization: "cbor:canonical:v1",
    artifacts: [
      {
        artifactId: IDS.artifact,
        artifactVersion: 1,
        kind: "CAPTURE",
        role: "PRIMARY",
        mimeType: "multipart/related",
        byteLength: 4,
        checksumAlgorithm: "hash:sha256:v1",
        checksum: new Uint8Array(32),
        path: "artifacts/primary.mhtml",
      },
    ],
  };
}

describe("domain boundary decoders", () => {
  it("accepts a valid CapturePage command", () => {
    expect(decodeCapturePageCommand(validCommand())).toMatchObject({
      commandId: IDS.command,
      observedUrl: "https://example.test/article",
    });
  });

  it.each([
    ["missing version", { commandVersion: undefined }],
    ["unsupported URL", { observedUrl: "chrome://extensions" }],
    ["malformed identifier", { commandId: "command-1" }],
    ["non-integer tab", { tabId: 4.2 }],
    ["mismatched idempotency key", { idempotencyKey: IDS.bundle }],
  ])("rejects a command with %s", (_label, replacement) => {
    expect(() => decodeCapturePageCommand({ ...validCommand(), ...replacement })).toThrow(
      DomainValidationError,
    );
  });

  it("rejects duplicate Artifact identifiers", () => {
    const manifest = validManifest();
    manifest.artifacts = [
      ...(manifest.artifacts as readonly unknown[]),
      {
        ...(manifest.artifacts as readonly Record<string, unknown>[])[0],
        role: "SCREENSHOT_FULL",
        path: "artifacts/screenshot-full.png",
      },
    ];

    expect(() => decodeBundleManifest(manifest)).toThrow(DomainValidationError);
  });

  it("preserves unknown optional Manifest fields", () => {
    const decoded = decodeBundleManifest({
      ...validManifest(),
      futureField: { enabled: true },
    });

    expect(decoded.unknownFields).toEqual({
      futureField: { enabled: true },
    });
  });

  it("accepts the canonical Bundle-local Artifact identifier", () => {
    expect(decodeBundleManifest(validManifest()).artifacts[0]?.artifactId).toBe("A000001");
  });

  it("rejects an unsupported encrypted-envelope version", () => {
    expect(() =>
      decodeEncryptedEnvelope({
        formatVersion: 2,
        objectType: "Bundle",
        algorithm: "enc:xchacha20poly1305:v1",
        objectId: IDS.object,
        payloadLength: 3,
        nonce: new Uint8Array(24),
        ciphertext: new Uint8Array(19),
      }),
    ).toThrow(DomainValidationError);
  });

  it("decodes persisted Projection and Job records only at version 1", () => {
    expect(
      decodeLibraryItem({
        version: 1,
        bundleId: IDS.bundle,
        bundleObjectId: IDS.object,
        title: "Example",
        originalUrl: "https://example.test/",
        capturedAt: "2026-07-16T17:00:00.000Z",
        screenshotPresent: false,
        status: "Active",
        warnings: [],
      }).title,
    ).toBe("Example");

    expect(() =>
      decodeCaptureJob({
        version: 2,
        jobId: IDS.command,
        commandId: IDS.command,
        tabId: 42,
        state: "Running",
        stage: "MHTML",
        createdAt: "2026-07-16T17:00:00.000Z",
        updatedAt: "2026-07-16T17:00:00.000Z",
      }),
    ).toThrow(DomainValidationError);
  });

  it("rejects unknown stable error identifiers", () => {
    expect(() =>
      decodeRuntimeError({
        id: "SOMETHING_NEW",
        message: "unknown",
      }),
    ).toThrow(DomainValidationError);
  });
});
