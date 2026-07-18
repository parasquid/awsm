import { encodeCanonicalCbor } from "../../domain/cbor";
import { sha256 } from "../../domain/hash";
import type {
  StoredEvent,
  StoredObjectV1,
  StoredVaultGenerationV1,
  StoredVaultHeadV1,
} from "../../drivers/indexeddb/schema";
import { verifyVaultGeneration } from "../vault/generation";
import type { VaultService } from "../vault/service";
import type { VaultPackageEntry } from "./container";
import type { ExportEntryDescriptorV1, ExportManifestV1 } from "./contracts";
import { verifyAuthoritativeVaultPackage } from "./verify";

export interface VaultExportSource {
  getVaultHead(): Promise<StoredVaultHeadV1 | undefined>;
  getVaultGeneration(generationId: string): Promise<StoredVaultGenerationV1 | undefined>;
  getStoredEvent(eventId: string): Promise<StoredEvent | undefined>;
  getStoredObject(objectId: string): Promise<StoredObjectV1 | undefined>;
  listAuthoritativeIds(): Promise<{
    readonly eventIds: readonly string[];
    readonly objectIds: readonly string[];
  }>;
}

export interface PreparedVaultExport {
  readonly manifest: ExportManifestV1;
  readonly entries: AsyncIterable<VaultPackageEntry>;
  assertSnapshotCurrent(): Promise<void>;
}

function exactUnion(left: readonly string[], right: readonly string[]): readonly string[] {
  const combined = [...left, ...right].toSorted();
  if (new Set(combined).size !== combined.length)
    throw new Error("Duplicate reachability identifier");
  return combined;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameHead(left: StoredVaultHeadV1, right: StoredVaultHeadV1): boolean {
  return (
    left.version === right.version &&
    left.vaultId === right.vaultId &&
    left.generationId === right.generationId &&
    left.generationNumber === right.generationNumber &&
    sameStrings(left.appendedEventIds, right.appendedEventIds) &&
    sameStrings(left.appendedObjectIds, right.appendedObjectIds)
  );
}

async function descriptor(
  path: string,
  recordType: ExportEntryDescriptorV1["recordType"],
  recordId: string,
  bytes: Uint8Array,
): Promise<ExportEntryDescriptorV1> {
  return {
    path,
    recordType,
    recordId,
    byteLength: bytes.byteLength,
    checksumAlgorithm: "hash:sha256:v1",
    checksum: await sha256(bytes),
  };
}

export class VaultExportService {
  constructor(
    private readonly source: VaultExportSource,
    private readonly vault: VaultService,
    private readonly vaultId: string,
  ) {}

  async prepare(input: {
    readonly packageId: string;
    readonly createdAt: string;
    readonly passphrase: string;
    readonly salt: Uint8Array;
    readonly nonce: Uint8Array;
  }): Promise<PreparedVaultExport> {
    const head = await this.source.getVaultHead();
    if (head === undefined || head.vaultId !== this.vaultId) throw new Error("Active head missing");
    const generation = await this.source.getVaultGeneration(head.generationId);
    if (generation === undefined || generation.generationNumber !== head.generationNumber)
      throw new Error("Active Generation missing");
    const retained = await verifyVaultGeneration(
      this.vault.requireRootKey(),
      this.vaultId,
      generation,
    );
    const eventIds = exactUnion(retained.retainedEventIds, head.appendedEventIds);
    const objectIds = exactUnion(retained.retainedObjectIds, head.appendedObjectIds);
    const storedIds = await this.source.listAuthoritativeIds();
    if (
      !sameStrings(eventIds, [...storedIds.eventIds].toSorted()) ||
      !sameStrings(objectIds, [...storedIds.objectIds].toSorted())
    )
      throw new Error("Authoritative reachability mismatch");
    const generationBytes = encodeCanonicalCbor(generation);
    const headBytes = encodeCanonicalCbor(head);
    const descriptors: ExportEntryDescriptorV1[] = [];
    for (const eventId of eventIds) {
      const event = await this.source.getStoredEvent(eventId);
      if (event === undefined || event.eventId !== eventId || event.vaultId !== this.vaultId) {
        throw new Error("Event missing or cross-Vault");
      }
      descriptors.push(
        await descriptor(`events/${eventId}.cbor`, "Event", eventId, encodeCanonicalCbor(event)),
      );
    }
    descriptors.push(
      await descriptor(
        "generation.cbor",
        "VaultGeneration",
        generation.generationId,
        generationBytes,
      ),
      await descriptor("head.cbor", "VaultHead", this.vaultId, headBytes),
    );
    for (const objectId of objectIds) {
      const object = await this.source.getStoredObject(objectId);
      if (object === undefined || object.objectId !== objectId || object.objectType !== "Bundle") {
        throw new Error("Object missing or unsupported");
      }
      descriptors.push(
        await descriptor(
          `objects/${objectId}.cbor`,
          "Object",
          objectId,
          encodeCanonicalCbor(object),
        ),
      );
    }
    descriptors.sort((left, right) => left.path.localeCompare(right.path));
    const manifest: ExportManifestV1 = {
      exportFormatVersion: 1,
      packageId: input.packageId,
      createdAt: input.createdAt,
      originatingVaultId: this.vaultId,
      vaultFormatVersion: 1,
      bundleFormatVersion: 1,
      eventFormatVersion: 1,
      generationId: generation.generationId,
      generationNumber: generation.generationNumber,
      objectCount: objectIds.length,
      eventCount: eventIds.length,
      supportedFeatures: ["full-vault", "vault-generation"],
      entries: descriptors,
      contentIntegrity: {
        algorithm: "hash:sha256:v1",
        checksum: await sha256(encodeCanonicalCbor(descriptors)),
      },
    };
    const manifestBytes = encodeCanonicalCbor(manifest);
    await verifyAuthoritativeVaultPackage({
      manifest,
      rootKey: this.vault.requireRootKey(),
      read: async (path) => {
        if (path === "generation.cbor") return generationBytes;
        if (path === "head.cbor") return headBytes;
        const eventMatch = /^events\/(.+)\.cbor$/u.exec(path);
        if (eventMatch?.[1] !== undefined) {
          const event = await this.source.getStoredEvent(eventMatch[1]);
          if (event !== undefined) return encodeCanonicalCbor(event);
        }
        const objectMatch = /^objects\/(.+)\.cbor$/u.exec(path);
        if (objectMatch?.[1] !== undefined) {
          const object = await this.source.getStoredObject(objectMatch[1]);
          if (object !== undefined) return encodeCanonicalCbor(object);
        }
        throw new Error("Authoritative Export record is missing");
      },
    });
    const keyEnvelope = await this.vault.createExportKeyEnvelope({
      packageId: input.packageId,
      manifestBytes,
      passphrase: input.passphrase,
      salt: input.salt,
      nonce: input.nonce,
    });
    const source = this.source;
    const vaultId = this.vaultId;
    return {
      manifest,
      assertSnapshotCurrent: async () => {
        const current = await source.getVaultHead();
        if (current === undefined || !sameHead(head, current))
          throw new Error("Vault head changed");
      },
      entries: {
        async *[Symbol.asyncIterator](): AsyncGenerator<VaultPackageEntry> {
          for (const eventId of eventIds) {
            const event = await source.getStoredEvent(eventId);
            if (event === undefined || event.vaultId !== vaultId) throw new Error("Event changed");
            yield { path: `events/${eventId}.cbor`, bytes: encodeCanonicalCbor(event) };
          }
          yield { path: "generation.cbor", bytes: generationBytes };
          yield { path: "head.cbor", bytes: headBytes };
          yield { path: "key.cbor", bytes: encodeCanonicalCbor(keyEnvelope) };
          yield { path: "manifest.cbor", bytes: manifestBytes };
          for (const objectId of objectIds) {
            const object = await source.getStoredObject(objectId);
            if (object === undefined || object.objectType !== "Bundle")
              throw new Error("Object changed");
            yield { path: `objects/${objectId}.cbor`, bytes: encodeCanonicalCbor(object) };
          }
        },
      },
    };
  }
}
