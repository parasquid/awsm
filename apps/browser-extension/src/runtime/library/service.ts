import { decodeEncryptedEnvelopeBytes, decryptEnvelope } from "../../crypto/envelope";
import { deriveContextKeyFromCryptoKey } from "../../crypto/hkdf";
import { wipe } from "../../crypto/sodium";
import { readBundle } from "../../domain/bundle";
import { decodeCanonicalCbor } from "../../domain/cbor";
import type { LibraryItemV1, RuntimeErrorId } from "../../domain/contracts";
import type { StoredObjectV1, StoredProjectionV1 } from "../../drivers/indexeddb";
import { decodeLibraryItem } from "./decode";

export interface LibraryRepository {
  listEncryptedProjections(): Promise<readonly StoredProjectionV1[]>;
  getStoredObject(objectId: string): Promise<StoredObjectV1 | undefined>;
}

export interface LibraryDetailV1 {
  readonly item: LibraryItemV1;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly mhtml: Uint8Array;
  readonly screenshot?: Uint8Array;
}

export interface LibraryPageGroupV1 {
  readonly pageKey: string;
  readonly title: string;
  readonly originalUrl: string;
  readonly latest: LibraryItemV1;
  readonly captures: readonly LibraryItemV1[];
}

export function normalizedPageKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function groupLibraryItems(items: readonly LibraryItemV1[]): readonly LibraryPageGroupV1[] {
  const groups = new Map<string, LibraryItemV1[]>();
  for (const item of items) {
    const key = normalizedPageKey(item.originalUrl);
    const captures = groups.get(key);
    if (captures === undefined) groups.set(key, [item]);
    else captures.push(item);
  }
  return [...groups.entries()]
    .map(([pageKey, captures]) => {
      const sorted = captures.toSorted((left, right) =>
        right.capturedAt.localeCompare(left.capturedAt),
      );
      const latest = sorted[0];
      if (latest === undefined) throw new Error("A Library group cannot be empty.");
      return {
        pageKey,
        title: latest.title,
        originalUrl: latest.originalUrl,
        latest,
        captures: sorted,
      };
    })
    .toSorted((left, right) => right.latest.capturedAt.localeCompare(left.latest.capturedAt));
}

export class LibraryError extends Error {
  readonly id: RuntimeErrorId;

  constructor(id: RuntimeErrorId, message: string) {
    super(message);
    this.name = "LibraryError";
    this.id = id;
  }
}

export class LibraryService {
  readonly repository: LibraryRepository;
  readonly rootKey: CryptoKey;
  readonly vaultId: string;

  constructor(repository: LibraryRepository, rootKey: CryptoKey, vaultId: string) {
    this.repository = repository;
    this.rootKey = rootKey;
    this.vaultId = vaultId;
  }

  async list(): Promise<readonly LibraryItemV1[]> {
    try {
      const records = await this.repository.listEncryptedProjections();
      const items = await Promise.all(records.map((record) => this.decryptProjection(record)));
      return items.toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    } catch {
      throw new LibraryError("BUNDLE_INVALID", "A library record could not be authenticated.");
    }
  }

  async listActive(): Promise<readonly LibraryItemV1[]> {
    return (await this.list()).filter((item) => item.status === "Active");
  }

  async listDeleted(): Promise<readonly LibraryItemV1[]> {
    return (await this.list()).filter((item) => item.status === "Deleted");
  }

  async groups(): Promise<readonly LibraryPageGroupV1[]> {
    return groupLibraryItems(await this.listActive());
  }

  async deletedGroups(): Promise<readonly LibraryPageGroupV1[]> {
    return groupLibraryItems(await this.listDeleted());
  }

  async detail(bundleId: string): Promise<LibraryDetailV1> {
    try {
      const item = (await this.list()).find((candidate) => candidate.bundleId === bundleId);
      if (item === undefined) throw new Error("Missing Projection");
      const record = await this.repository.getStoredObject(item.bundleObjectId);
      if (record === undefined || record.objectType !== "Bundle") throw new Error("Missing Object");
      const key = await deriveContextKeyFromCryptoKey(this.rootKey, {
        vaultId: this.vaultId,
        domain: "vault:bundle:v1",
        contextId: item.bundleId,
        keyVersion: 1,
      });
      try {
        const envelope = decodeEncryptedEnvelopeBytes(record.envelopeBytes);
        if (envelope.objectId !== record.objectId || envelope.objectType !== "Bundle") {
          throw new Error("Object envelope mismatch");
        }
        const bundle = await readBundle(await decryptEnvelope(envelope, key));
        const mhtml = bundle.artifacts.get("PRIMARY");
        if (mhtml === undefined) throw new Error("Missing MHTML");
        const screenshot = bundle.artifacts.get("SCREENSHOT_FULL");
        return {
          item,
          metadata: bundle.metadata,
          mhtml,
          ...(screenshot === undefined ? {} : { screenshot }),
        };
      } finally {
        await wipe(key);
      }
    } catch {
      throw new LibraryError("BUNDLE_INVALID", "The archived capture is missing or corrupt.");
    }
  }

  private async decryptProjection(record: StoredProjectionV1): Promise<LibraryItemV1> {
    const key = await deriveContextKeyFromCryptoKey(this.rootKey, {
      vaultId: this.vaultId,
      domain: "vault:projection:v1",
      contextId: `LibraryItem-v1:${record.bundleId}`,
      keyVersion: 1,
    });
    try {
      const envelope = decodeEncryptedEnvelopeBytes(record.envelopeBytes);
      if (envelope.objectId !== record.bundleId || envelope.objectType !== "Projection") {
        throw new Error("Projection envelope mismatch");
      }
      return decodeLibraryItem(decodeCanonicalCbor(await decryptEnvelope(envelope, key)));
    } finally {
      await wipe(key);
    }
  }
}
