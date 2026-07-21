import { readySodium } from "../../crypto/sodium";
import { bytesEqual } from "../../domain/hash";
import type { StoredArtifactObjectV1 } from "../../drivers/indexeddb/schema";

function integrity(): Error {
  return Object.assign(new Error("The remote Artifact wrapper failed integrity verification."), {
    id: "REMOTE_ARTIFACT_INTEGRITY_FAILED",
  });
}

export async function verifiedArtifactStream(
  source: ReadableStream<Uint8Array>,
  object: StoredArtifactObjectV1,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const sodium = await readySodium();
  const hash = sodium.crypto_hash_sha256_init();
  let byteLength = 0;
  const verifier = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      signal?.throwIfAborted();
      byteLength += chunk.byteLength;
      if (!Number.isSafeInteger(byteLength) || byteLength > object.envelopeByteLength)
        throw integrity();
      sodium.crypto_hash_sha256_update(hash, chunk);
      controller.enqueue(chunk);
    },
    flush() {
      const checksum = Uint8Array.from(sodium.crypto_hash_sha256_final(hash));
      if (
        byteLength !== object.envelopeByteLength ||
        !bytesEqual(checksum, object.envelopeChecksum)
      )
        throw integrity();
    },
  });
  return source.pipeThrough(verifier, signal === undefined ? undefined : { signal });
}
