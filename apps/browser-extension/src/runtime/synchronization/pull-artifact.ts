import type { StoredArtifactObjectV1 } from "../../drivers/indexeddb/schema";

interface PullArtifactAvailability {
  isArtifactRemoteOnly(vaultId: string, artifactObjectId: string): Promise<boolean>;
}

interface PullArtifactReaders {
  local(input: {
    readonly vaultId: string;
    readonly object: StoredArtifactObjectV1;
  }): Promise<ReadableStream<Uint8Array>>;
  remote(input: {
    readonly vaultId: string;
    readonly object: StoredArtifactObjectV1;
    readonly generationId: string;
  }): Promise<ReadableStream<Uint8Array>>;
}

export async function openPullArtifact(
  input: {
    readonly vaultId: string;
    readonly object: StoredArtifactObjectV1;
    readonly generationId: string;
  },
  availability: PullArtifactAvailability,
  readers: PullArtifactReaders,
): Promise<ReadableStream<Uint8Array>> {
  return (await availability.isArtifactRemoteOnly(input.vaultId, input.object.objectId))
    ? readers.remote(input)
    : readers.local(input);
}
