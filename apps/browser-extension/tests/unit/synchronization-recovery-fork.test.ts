import { describe, expect, it } from "vitest";
import { writeArtifactEnvelope } from "../../src/crypto/artifact-envelope";
import { deriveContextKeyFromCryptoKey } from "../../src/crypto/hkdf";
import type { ArtifactReferenceV1, CaptureMetadataV1 } from "../../src/domain/artifact-graph";
import type { LibraryItemV1 } from "../../src/domain/contracts";
import type { StoredArtifactObjectV1 } from "../../src/drivers/indexeddb/schema";
import type { ArtifactStore } from "../../src/runtime/artifact";
import type { LibraryService } from "../../src/runtime/library/service";
import { LocalRecoveryForkBuilder } from "../../src/runtime/synchronization/recovery-fork";
import { VaultService } from "../../src/runtime/vault/service";

describe("local stale-Replica recovery fork", () => {
  it("creates a fresh local-only Vault identity and canonical recovery name", async () => {
    const sourceVaultId = "01900000-0000-7000-8000-000000000601";
    const source = {
      list: async () => [],
      topology: async () => [],
    } as unknown as LibraryService;
    const artifacts = {
      prepare: async () => {
        throw new Error("unexpected");
      },
      prepareEncrypted: async () => undefined,
      openEncrypted: async () => {
        throw new Error("unexpected");
      },
      openPlaintext: async () => {
        throw new Error("unexpected");
      },
      remove: async () => undefined,
      reconcile: async () => undefined,
    };
    const builder = new LocalRecoveryForkBuilder(
      source,
      "A".repeat(64),
      new VaultService({} as never),
      artifacts,
      "0.1.0",
    );

    const fork = await builder.prepare();

    expect(fork.records.metadata.vaultId).not.toBe(sourceVaultId);
    expect(fork.records.metadata.manuallyLocked).toBe(false);
    expect(Array.from(fork.name)).toHaveLength(64);
    expect(fork.name.endsWith(" — recovered local copy")).toBe(true);
    expect(fork.events).toHaveLength(1);
    expect(fork.records.head.appendedEventIds).toEqual([fork.events[0]?.eventId]);
  });

  it("preserves retained plaintext and current active, deleted, warning, and Collection state", async () => {
    const id = (value: number): string =>
      `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
    const sourceVaultId = id(601);
    const firstBundleId = id(610);
    const secondBundleId = id(620);
    const capturedAt = "2026-07-18T20:00:00.000Z";
    const later = "2026-07-18T21:00:00.000Z";
    const firstCollection = id(630);
    const secondCollection = id(631);
    const items: LibraryItemV1[] = [
      {
        version: 1,
        bundleId: firstBundleId,
        descriptorObjectId: id(611),
        assignedCollectionId: firstCollection,
        title: "Retained article",
        originalUrl: "https://example.test/retained",
        capturedAt,
        artifactRoles: ["PRIMARY", "TEXT_EXTRACTED"],
        status: "Active",
        warnings: ["SCREENSHOT_CAPTURE_FAILED", "STRUCTURED_CONTENT_EXTRACTION_FAILED"],
      },
      {
        version: 1,
        bundleId: secondBundleId,
        descriptorObjectId: id(621),
        assignedCollectionId: secondCollection,
        title: "Deleted article",
        originalUrl: "https://example.test/deleted",
        capturedAt: later,
        artifactRoles: ["PRIMARY"],
        status: "Deleted",
        warnings: [
          "SCREENSHOT_CAPTURE_FAILED",
          "STRUCTURED_CONTENT_EXTRACTION_FAILED",
          "TEXT_EXTRACTION_FAILED",
        ],
      },
    ];
    const metadata = (item: LibraryItemV1): CaptureMetadataV1 => ({
      version: 1,
      originalUrl: item.originalUrl,
      finalUrl: item.originalUrl,
      title: item.title,
      capturedAt: item.capturedAt,
      contentType: "text/html",
      viewport: { width: 1280, height: 720 },
      document: { width: 1280, height: 2400 },
      chromeVersion: "149",
      extensionVersion: "0.1.0",
      captureProfileId: "ChromeWebPage-v1",
      captureProfileVersion: 1,
    });
    const plaintext = new Map([
      [`${firstBundleId}:PRIMARY`, new TextEncoder().encode("first mhtml")],
      [`${firstBundleId}:TEXT_EXTRACTED`, new TextEncoder().encode("first text")],
      [`${secondBundleId}:PRIMARY`, new TextEncoder().encode("deleted mhtml")],
    ]);
    const definitions = {
      PRIMARY: { kind: "CAPTURE", mimeType: "multipart/related" },
      TEXT_EXTRACTED: { kind: "TEXT", mimeType: "text/plain;charset=utf-8" },
    } as const;
    const artifactsByBundle = (item: LibraryItemV1) =>
      item.artifactRoles.map((role) => ({
        role,
        state: "Present" as const,
        kind: definitions[role as keyof typeof definitions].kind,
        mimeType: definitions[role as keyof typeof definitions].mimeType,
        byteLength: plaintext.get(`${item.bundleId}:${role}`)?.byteLength,
        acquiredAt: item.capturedAt,
        canPreview: false,
        canInspect: role === "TEXT_EXTRACTED",
        canDownload: true,
      }));
    const source = {
      list: async () => items,
      detail: async (bundleId: string) => {
        const item = items.find((candidate) => candidate.bundleId === bundleId);
        if (item === undefined) throw new Error("missing source item");
        return { item, metadata: metadata(item), artifacts: artifactsByBundle(item) };
      },
      openArtifact: async (bundleId: string, role: ArtifactReferenceV1["role"]) => {
        const item = items.find((candidate) => candidate.bundleId === bundleId);
        const bytes = plaintext.get(`${bundleId}:${role}`);
        if (item === undefined || bytes === undefined) throw new Error("missing source Artifact");
        const definition = definitions[role as keyof typeof definitions];
        return {
          item,
          reference: {
            artifactVersion: 1,
            artifactObjectId: crypto.randomUUID(),
            kind: definition.kind,
            role,
            mimeType: definition.mimeType,
            acquiredAt: item.capturedAt,
            plaintextByteLength: bytes.byteLength,
            checksumAlgorithm: "hash:sha256:v1",
            plaintextChecksum: new Uint8Array(32),
          },
          stream: new Blob([Uint8Array.from(bytes).buffer]).stream(),
        };
      },
      topology: async () => [
        {
          eventId: id(640),
          eventType: "CollectionsMerged" as const,
          destinationCollectionId: firstCollection,
          sourceCollectionIds: [secondCollection],
        },
      ],
    } as unknown as LibraryService;
    const encrypted = new Map<string, Uint8Array>();
    const copiedPlaintext: Uint8Array[] = [];
    const artifacts = {
      prepare: async (input: {
        vaultId: string;
        objectId: string;
        rootKey: CryptoKey;
        plaintext: AsyncIterable<Uint8Array>;
      }) => {
        const key = await deriveContextKeyFromCryptoKey(input.rootKey, {
          vaultId: input.vaultId,
          domain: "vault:artifact:v1",
          contextId: input.objectId,
          keyVersion: 1,
        });
        const clearChunks: Uint8Array[] = [];
        const envelopeChunks: Uint8Array[] = [];
        const summary = await writeArtifactEnvelope({
          objectId: input.objectId,
          key,
          plaintext: (async function* () {
            for await (const chunk of input.plaintext) {
              clearChunks.push(Uint8Array.from(chunk));
              yield chunk;
            }
          })(),
          write: (chunk) => {
            envelopeChunks.push(Uint8Array.from(chunk));
          },
        });
        const clear = new Uint8Array(clearChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
        let clearOffset = 0;
        for (const chunk of clearChunks) {
          clear.set(chunk, clearOffset);
          clearOffset += chunk.byteLength;
        }
        copiedPlaintext.push(clear);
        const envelope = new Uint8Array(
          envelopeChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
        );
        let envelopeOffset = 0;
        for (const chunk of envelopeChunks) {
          envelope.set(chunk, envelopeOffset);
          envelopeOffset += chunk.byteLength;
        }
        encrypted.set(input.objectId, envelope);
        const object: StoredArtifactObjectV1 = {
          version: 1,
          objectId: input.objectId,
          objectType: "Artifact",
          envelopeFormat: "artifact:xchacha20poly1305-chunked:v1",
          envelopeByteLength: summary.envelopeByteLength,
          envelopeChecksumAlgorithm: "hash:sha256:v1",
          envelopeChecksum: summary.envelopeChecksum,
        };
        return {
          object,
          plaintextByteLength: summary.plaintextByteLength,
          plaintextChecksum: summary.plaintextChecksum,
        };
      },
      openEncrypted: async (_vaultId: string, objectId: string) => {
        const bytes = encrypted.get(objectId);
        if (bytes === undefined) throw new Error("missing fork Artifact");
        return new Blob([Uint8Array.from(bytes).buffer]).stream();
      },
      remove: async () => undefined,
    } as unknown as ArtifactStore;
    const builder = new LocalRecoveryForkBuilder(
      source,
      "Stale source",
      new VaultService({} as never),
      artifacts,
      "0.1.0",
    );

    const fork = await builder.prepare();

    expect(fork.records.metadata.vaultId).not.toBe(sourceVaultId);
    expect(fork.objects.filter((object) => object.objectType === "Artifact")).toHaveLength(3);
    expect(copiedPlaintext.map((bytes) => new TextDecoder().decode(bytes)).toSorted()).toEqual([
      "deleted mhtml",
      "first mhtml",
      "first text",
    ]);
    const repository = {
      listEncryptedProjections: async () => fork.libraryProjections,
      getCollectionProjection: async () => fork.collectionProjection,
      getStoredObject: async (objectId: string) =>
        fork.objects.find((object) => object.objectId === objectId),
    };
    const recovered = new (await import("../../src/runtime/library/service")).LibraryService(
      repository,
      fork.rootKey,
      fork.records.metadata.vaultId,
      artifacts,
    );
    expect(
      (await recovered.list()).map((item) => ({
        title: item.title,
        status: item.status,
        warnings: item.warnings,
        roles: item.artifactRoles,
      })),
    ).toEqual([
      {
        title: "Deleted article",
        status: "Deleted",
        warnings: [
          "SCREENSHOT_CAPTURE_FAILED",
          "STRUCTURED_CONTENT_EXTRACTION_FAILED",
          "TEXT_EXTRACTION_FAILED",
        ],
        roles: ["PRIMARY"],
      },
      {
        title: "Retained article",
        status: "Active",
        warnings: ["SCREENSHOT_CAPTURE_FAILED", "STRUCTURED_CONTENT_EXTRACTION_FAILED"],
        roles: ["PRIMARY", "TEXT_EXTRACTED"],
      },
    ]);
    const topology = await recovered.topology();
    expect(topology).toHaveLength(1);
    expect(topology[0]).toMatchObject({ eventType: "CollectionsMerged" });
    expect(topology[0]?.eventId).not.toBe(id(640));
    expect(fork.events.map((event) => event.eventId)).not.toContain(id(640));
  });
});
