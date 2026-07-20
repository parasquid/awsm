import type {
  StoredAccountVaultV1,
  StoredEvent,
  StoredObjectV1,
  StoredVaultGenerationV1,
  SynchronizationJobV1,
} from "../../drivers/indexeddb/schema";
import type { AtomicStaleRecovery } from "../../drivers/indexeddb/workspace-repository";
import type { ArtifactStore } from "../artifact";
import { noRuntimeFaultCheckpoint, type RuntimeFaultCheckpoint } from "../fault-checkpoint";
import { LibraryProjectionRebuilder } from "../library/rebuild";
import type { VaultRecordsV1 } from "../vault";
import { encryptWorkspaceVaultName } from "../vault";
import { type RemoteReplicaDownloader, verifyPreparedRemoteReplica } from "./download";
import type { LocalRecoveryForkBuilder } from "./recovery-fork";

interface RecoveryAccountStore {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  loadAccountVault(): Promise<StoredAccountVaultV1 | undefined>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
}

interface RecoverySource {
  listStoredEvents(): Promise<readonly StoredEvent[]>;
  listStoredObjects(): Promise<readonly StoredObjectV1[]>;
  getVaultGeneration(generationId: string): Promise<StoredVaultGenerationV1 | undefined>;
}

interface RecoveryWorkspace {
  load(): Promise<
    | {
        readonly metadata: { readonly workspaceId: string };
        readonly nameCacheKey: CryptoKey;
      }
    | undefined
  >;
  commitStaleRecovery(input: AtomicStaleRecovery): Promise<void>;
}

function integrity(message: string): Error {
  return Object.assign(new Error(message), { id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
}

export class StaleReplicaRecoveryService {
  constructor(
    private readonly accounts: RecoveryAccountStore,
    private readonly workspace: RecoveryWorkspace,
    private readonly source: RecoverySource,
    private readonly originalRecords: VaultRecordsV1,
    private readonly originalRootKey: CryptoKey,
    private readonly forkBuilder: LocalRecoveryForkBuilder,
    private readonly downloader: Pick<RemoteReplicaDownloader, "prepare">,
    private readonly artifacts: ArtifactStore,
    private readonly faultCheckpoint: RuntimeFaultCheckpoint = noRuntimeFaultCheckpoint,
  ) {}

  async execute(now = new Date().toISOString()): Promise<{ readonly forkVaultId: string }> {
    const conflictJob = await this.accounts.latestSynchronizationJob();
    const registration = await this.accounts.loadAccountVault();
    const staleGenerationId = this.originalRecords.head.generationId;
    if (
      conflictJob?.state !== "Conflict" ||
      conflictJob.vaultId !== this.originalRecords.metadata.vaultId ||
      conflictJob.generationId === undefined ||
      conflictJob.generationNumber === undefined ||
      registration?.vaultId !== conflictJob.vaultId ||
      registration.remoteGenerationId !== conflictJob.generationId
    )
      throw integrity("Stale recovery context is unavailable");
    const vaultId = conflictJob.vaultId;
    let job: SynchronizationJobV1 = {
      ...conflictJob,
      state: "Running",
      stage: "PrepareRecoveryFork",
      updatedAt: now,
    };
    await this.accounts.saveSynchronizationJob(job);
    await this.faultCheckpoint.reach("stale-recovery:prepare-fork");
    let forkVaultId: string | undefined;
    let remotePreparedIds: readonly string[] = [];
    let committed = false;
    try {
      const fork = await this.forkBuilder.prepare(async (createdForkVaultId) => {
        forkVaultId = createdForkVaultId;
        job = { ...job, recoveryForkVaultId: createdForkVaultId, updatedAt: now };
        await this.accounts.saveSynchronizationJob(job);
      });
      forkVaultId = fork.records.metadata.vaultId;
      if (job.recoveryForkVaultId !== forkVaultId) {
        job = { ...job, recoveryForkVaultId: forkVaultId, updatedAt: now };
        await this.accounts.saveSynchronizationJob(job);
      }
      await this.faultCheckpoint.reach("stale-recovery:fork-persisted");
      job = { ...job, stage: "PrepareServerReplacement", updatedAt: now };
      await this.accounts.saveSynchronizationJob(job);
      await this.faultCheckpoint.reach("stale-recovery:prepare-server-replacement");
      const [events, objects, generation] = await Promise.all([
        this.source.listStoredEvents(),
        this.source.listStoredObjects(),
        this.source.getVaultGeneration(staleGenerationId),
      ]);
      if (generation === undefined) throw integrity("Stale Generation is unavailable");
      const prepared = await this.downloader.prepare(
        { ...job, state: "Running", stage: "DownloadRecords" },
        this.originalRootKey,
        { generation, events, objects },
      );
      remotePreparedIds = prepared.preparedArtifactObjectIds;
      await this.faultCheckpoint.reach("stale-recovery:remote-prepared");
      const remote = await verifyPreparedRemoteReplica({
        vaultId,
        prepared,
        rootKey: this.originalRootKey,
        artifacts: this.artifacts,
      });
      const remoteObjects = new Map(remote.objects.map((object) => [object.objectId, object]));
      const projections = await new LibraryProjectionRebuilder(
        {
          listStoredEvents: () => Promise.resolve(remote.events),
          getStoredObject: (objectId) => Promise.resolve(remoteObjects.get(objectId)),
          replaceLibraryProjections: () => Promise.resolve(),
        },
        this.originalRootKey,
        vaultId,
        this.artifacts,
      ).prepare(new AbortController().signal);
      const workspace = await this.workspace.load();
      if (workspace === undefined) throw integrity("Workspace is unavailable");
      const [remoteNameCache, forkNameCache] = await Promise.all([
        encryptWorkspaceVaultName({
          key: workspace.nameCacheKey,
          workspaceId: workspace.metadata.workspaceId,
          vaultId,
          sourceEventId: projections.vaultNameProjection.sourceEventId,
          name: remote.currentVaultName,
        }),
        encryptWorkspaceVaultName({
          key: workspace.nameCacheKey,
          workspaceId: workspace.metadata.workspaceId,
          vaultId: fork.records.metadata.vaultId,
          sourceEventId: fork.vaultNameProjection.sourceEventId,
          name: fork.name,
        }),
      ]);
      job = { ...job, stage: "ActivateRecovery", updatedAt: now };
      await this.accounts.saveSynchronizationJob(job);
      await this.faultCheckpoint.reach("stale-recovery:before-activation");
      await this.workspace.commitStaleRecovery({
        job,
        expectedStaleGenerationId: staleGenerationId,
        registration,
        originalRecords: this.originalRecords,
        remoteGeneration: remote.generation,
        remoteHead: remote.head,
        remoteEvents: remote.events,
        remoteObjects: remote.objects,
        remoteLibraryProjections: projections.itemProjections,
        remoteCollectionProjection: projections.collectionProjection,
        remoteVaultNameProjection: projections.vaultNameProjection,
        remoteNameCache,
        fork: {
          records: fork.records,
          events: fork.events,
          objects: fork.objects,
          libraryProjections: fork.libraryProjections,
          collectionProjection: fork.collectionProjection,
          vaultNameProjection: fork.vaultNameProjection,
          nameCache: forkNameCache,
        },
      });
      committed = true;
      await this.faultCheckpoint.reach("stale-recovery:after-activation");
      await this.artifacts
        .reconcile(
          vaultId,
          new Set(
            remote.objects
              .filter((object) => object.objectType === "Artifact")
              .map((object) => object.objectId),
          ),
        )
        .catch(() => undefined);
      return { forkVaultId };
    } catch (error) {
      const { recoveryForkVaultId: _recoveryForkVaultId, ...withoutFork } = job;
      await this.accounts.saveSynchronizationJob({
        ...withoutFork,
        state: "Conflict",
        stage: "Checkpoint",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      if (!committed) {
        if (forkVaultId !== undefined)
          await this.artifacts.reconcile(forkVaultId, new Set()).catch(() => undefined);
        await Promise.all(
          remotePreparedIds.map((objectId) =>
            this.artifacts
              .remove(this.originalRecords.metadata.vaultId, objectId)
              .catch(() => undefined),
          ),
        );
      }
    }
  }
}
