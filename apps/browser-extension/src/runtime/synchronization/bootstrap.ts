import { wipe } from "../../crypto/sodium";
import type { StoredAccountVaultV1, SynchronizationJobV1 } from "../../drivers/indexeddb/schema";
import type { AtomicRemoteBootstrap } from "../../drivers/indexeddb/workspace-repository";
import { openAccountVaultSlot } from "../account/crypto";
import type { ArtifactStore } from "../artifact";
import { prepareReplicaDeviceCredentials } from "../import/credentials";
import { LibraryProjectionRebuilder } from "../library/rebuild";
import { encryptWorkspaceVaultName } from "../vault";
import { decodeAccountVaultSlot } from "./discovery";
import { type RemoteReplicaDownloader, verifyPreparedRemoteReplica } from "./download";

interface BootstrapAccountStore {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  loadAccountVault(): Promise<StoredAccountVaultV1 | undefined>;
  loadAccountEncryptionKey(): Promise<Uint8Array>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
}

interface BootstrapWorkspaceStore {
  load(): Promise<
    | {
        readonly metadata: { readonly workspaceId: string };
        readonly nameCacheKey: CryptoKey;
      }
    | undefined
  >;
  commitRemoteBootstrap(input: AtomicRemoteBootstrap): Promise<void>;
}

function integrity(message: string): Error {
  return Object.assign(new Error(message), { id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
}

async function importRootKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", Uint8Array.from(raw), "HKDF", false, ["deriveBits"]);
}

export class RemoteBootstrapRunner {
  constructor(
    private readonly accounts: BootstrapAccountStore,
    private readonly workspace: BootstrapWorkspaceStore,
    private readonly artifacts: ArtifactStore,
    private readonly downloader: Pick<RemoteReplicaDownloader, "prepare">,
  ) {}

  async run(now = new Date().toISOString()): Promise<string | undefined> {
    let job = await this.accounts.latestSynchronizationJob();
    if (job?.stage !== "DownloadRecords" || job.vaultId === undefined) return undefined;
    const vaultId = job.vaultId;
    const registration = await this.accounts.loadAccountVault();
    if (
      registration === undefined ||
      registration.accountId !== job.accountId ||
      registration.vaultId !== job.vaultId
    )
      throw integrity("Remote bootstrap Account context changed");
    const accountEncryptionKey = await this.accounts.loadAccountEncryptionKey();
    let rawRootKey: Uint8Array | undefined;
    let preparedArtifactIds: readonly string[] = [];
    let committed = false;
    try {
      rawRootKey = await openAccountVaultSlot(
        decodeAccountVaultSlot(registration.accountSlot),
        accountEncryptionKey,
      );
      const rootKey = await importRootKey(rawRootKey);
      const prepared = await this.downloader.prepare(job, rootKey);
      preparedArtifactIds = prepared.preparedArtifactObjectIds;
      const verified = await verifyPreparedRemoteReplica({
        vaultId: job.vaultId,
        prepared,
        rootKey,
        artifacts: this.artifacts,
      });
      const records = await prepareReplicaDeviceCredentials({
        vaultId: job.vaultId,
        vaultCreatedAt: verified.vaultCreatedAt,
        generation: verified.generation,
        head: verified.head,
        rawRootKey,
        manuallyLocked: false,
      });
      const objects = new Map(verified.objects.map((object) => [object.objectId, object]));
      const projections = await new LibraryProjectionRebuilder(
        {
          listStoredEvents: () => Promise.resolve(verified.events),
          getStoredObject: (objectId) => Promise.resolve(objects.get(objectId)),
          replaceLibraryProjections: () => Promise.resolve(),
        },
        rootKey,
        job.vaultId,
        this.artifacts,
      ).prepare(new AbortController().signal);
      const workspace = await this.workspace.load();
      if (workspace === undefined) throw integrity("Workspace is not initialized");
      const nameCache = await encryptWorkspaceVaultName({
        key: workspace.nameCacheKey,
        workspaceId: workspace.metadata.workspaceId,
        vaultId: job.vaultId,
        sourceEventId: projections.vaultNameProjection.sourceEventId,
        name: verified.currentVaultName,
      });
      job = { ...job, state: "Running", stage: "ActivateLocal", updatedAt: now };
      await this.accounts.saveSynchronizationJob(job);
      await this.workspace.commitRemoteBootstrap({
        job,
        records,
        events: verified.events,
        objects: verified.objects,
        libraryProjections: projections.itemProjections,
        collectionProjection: projections.collectionProjection,
        vaultNameProjection: projections.vaultNameProjection,
        nameCache,
        preparedArtifactObjectIds: preparedArtifactIds,
      });
      committed = true;
      return job.vaultId;
    } finally {
      await wipe(accountEncryptionKey);
      if (rawRootKey !== undefined) await wipe(rawRootKey);
      if (!committed)
        await Promise.all(
          preparedArtifactIds.map((objectId) =>
            this.artifacts.remove(vaultId, objectId).catch(() => undefined),
          ),
        );
    }
  }
}
