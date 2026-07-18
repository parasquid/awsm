import type { ArtifactReferenceV1 } from "../../domain/artifact-graph";
import type { StoredArtifactObjectV1 } from "../../drivers/indexeddb/schema";

export interface PreparedArtifact {
  readonly object: StoredArtifactObjectV1;
  readonly plaintextByteLength: number;
  readonly plaintextChecksum: Uint8Array;
}

export interface ArtifactStore {
  prepare(input: {
    readonly vaultId: string;
    readonly objectId: string;
    readonly rootKey: CryptoKey;
    readonly plaintext: AsyncIterable<Uint8Array>;
    readonly noncePrefix?: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<PreparedArtifact>;

  openEncrypted(vaultId: string, objectId: string): Promise<ReadableStream<Uint8Array>>;

  openPlaintext(input: {
    readonly vaultId: string;
    readonly object: StoredArtifactObjectV1;
    readonly reference: ArtifactReferenceV1;
    readonly rootKey: CryptoKey;
    readonly signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;

  remove(vaultId: string, objectId: string): Promise<void>;

  reconcile(vaultId: string, authoritativeIds: ReadonlySet<string>): Promise<void>;
}
