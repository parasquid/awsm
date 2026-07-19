import { BlobReader, type FileEntry, ZipReader } from "@zip.js/zip.js";
import type { StoredArtifactObjectV1, StoredObjectV1 } from "../../drivers/indexeddb";
import type { ArtifactStore } from "../artifact";

export async function prepareImportedArtifacts(input: {
  readonly source: Blob;
  readonly vaultId: string;
  readonly objects: readonly StoredObjectV1[];
  readonly artifactStore: ArtifactStore;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completedEntries: number, processedBytes: number) => Promise<void> | void;
}): Promise<readonly StoredArtifactObjectV1[]> {
  const artifacts = input.objects
    .filter((object): object is StoredArtifactObjectV1 => object.objectType === "Artifact")
    .toSorted((left, right) => left.objectId.localeCompare(right.objectId));
  const reader = new ZipReader(new BlobReader(input.source), {
    useWebWorkers: false,
    checkSignature: true,
    checkOverlappingEntry: true,
  });
  try {
    const entries = new Map(
      (await reader.getEntries()).map((entry) => [entry.filename, entry as FileEntry]),
    );
    let processedBytes = 0;
    for (const [index, object] of artifacts.entries()) {
      input.signal?.throwIfAborted();
      const entry = entries.get(`artifacts/${object.objectId}.bin`);
      if (
        entry === undefined ||
        entry.directory ||
        entry.encrypted ||
        entry.compressionMethod !== 0 ||
        entry.uncompressedSize !== object.envelopeByteLength ||
        entry.compressedSize !== object.envelopeByteLength
      ) {
        throw new Error("Validated Artifact entry is unavailable.");
      }
      const transfer = new TransformStream<Uint8Array, Uint8Array>();
      const write = entry.getData(
        transfer.writable,
        input.signal === undefined ? undefined : { signal: input.signal },
      );
      const prepare = input.artifactStore.prepareEncrypted({
        vaultId: input.vaultId,
        object,
        encrypted: transfer.readable,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      await Promise.all([write, prepare]);
      processedBytes += object.envelopeByteLength;
      await input.onProgress?.(index + 1, processedBytes);
    }
    return artifacts;
  } finally {
    await reader.close().catch(() => undefined);
  }
}
