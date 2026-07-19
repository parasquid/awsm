import type { ArtifactRole } from "../../domain/artifact-graph";
import type { LibraryItemV1 } from "../../domain/contracts";
import type {
  StoredCollectionProjectionV1,
  StoredEvent,
  StoredObjectV1,
  StoredProjectionV1,
  StoredVaultNameProjectionV1,
} from "../../drivers/indexeddb/schema";
import type { ArtifactStore } from "../artifact";
import { prepareCaptureRegistration } from "../capture/registration";
import type { CollectionTopologyEventV1 } from "../library/collections";
import { prepareLibraryStateChange } from "../library/lifecycle";
import { prepareCollectionOperation } from "../library/management";
import { LibraryProjectionRebuilder } from "../library/rebuild";
import type { LibraryService } from "../library/service";
import type { PreparedVault, VaultRecordsV1 } from "../vault";
import { prepareVaultNameChange } from "../vault/name-crypto";
import { type PreparedRemoteReplica, verifyPreparedRemoteReplica } from "./download";

interface ForkVaultPreparer {
  prepareCreate(input: {
    readonly name: string;
    readonly createdAt: string;
  }): Promise<PreparedVault>;
}

export interface PreparedLocalRecoveryFork {
  readonly records: VaultRecordsV1;
  readonly rootKey: CryptoKey;
  readonly name: string;
  readonly events: readonly StoredEvent[];
  readonly objects: readonly StoredObjectV1[];
  readonly libraryProjections: readonly StoredProjectionV1[];
  readonly collectionProjection: StoredCollectionProjectionV1;
  readonly vaultNameProjection: StoredVaultNameProjectionV1;
  readonly preparedArtifactObjectIds: readonly string[];
}

function recoveredName(sourceName: string): string {
  const suffix = " — recovered local copy";
  const maximumSource = 64 - Array.from(suffix).length;
  return `${Array.from(sourceName).slice(0, maximumSource).join("").trimEnd()}${suffix}`;
}

function before(timestamp: string): string {
  return new Date(Date.parse(timestamp) - 1).toISOString();
}

function after(timestamp: string, offset: number): string {
  return new Date(Date.parse(timestamp) + offset + 1).toISOString();
}

async function* chunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function currentMerges(
  topology: readonly CollectionTopologyEventV1[],
): readonly Extract<CollectionTopologyEventV1, { eventType: "CollectionsMerged" }>[] {
  const reverted = new Set(
    topology
      .filter((event) => event.eventType === "CollectionMergeReverted")
      .map((event) => event.mergeEventId),
  );
  return topology.filter(
    (event): event is Extract<CollectionTopologyEventV1, { eventType: "CollectionsMerged" }> =>
      event.eventType === "CollectionsMerged" && !reverted.has(event.eventId),
  );
}

export class LocalRecoveryForkBuilder {
  constructor(
    private readonly source: LibraryService,
    private readonly sourceName: string,
    private readonly vaults: ForkVaultPreparer,
    private readonly artifacts: ArtifactStore,
    private readonly clientVersion: string,
    private readonly didCreateFork?: (vaultId: string) => Promise<void>,
  ) {}

  async prepare(
    didCreateFork: ((vaultId: string) => Promise<void>) | undefined = this.didCreateFork,
  ): Promise<PreparedLocalRecoveryFork> {
    const sourceItems = await this.source.list();
    const earliest =
      sourceItems.map((item) => item.capturedAt).toSorted()[0] ?? new Date().toISOString();
    const latest =
      sourceItems
        .map((item) => item.capturedAt)
        .toSorted()
        .at(-1) ?? earliest;
    const name = recoveredName(this.sourceName);
    const preparedVault = await this.vaults.prepareCreate({ name, createdAt: before(earliest) });
    const { records, rootKey } = preparedVault;
    const vaultId = records.metadata.vaultId;
    const deviceId = records.metadata.deviceId;
    await didCreateFork?.(vaultId);
    const objects: StoredObjectV1[] = [];
    const events: StoredEvent[] = [];
    const preparedArtifactObjectIds: string[] = [];
    const newItems: LibraryItemV1[] = [];
    const newItemBySourceBundle = new Map<string, LibraryItemV1>();
    const collectionIds = new Map<string, string>();
    const collectionId = (sourceId: string): string => {
      const existing = collectionIds.get(sourceId);
      if (existing !== undefined) return existing;
      const created = crypto.randomUUID();
      collectionIds.set(sourceId, created);
      return created;
    };
    try {
      const nameEvent = await prepareVaultNameChange({
        rootKey,
        eventType: "VaultCreated",
        vaultId,
        deviceId,
        eventId: crypto.randomUUID(),
        timestamp: records.metadata.createdAt,
        name,
      });
      events.push(nameEvent.event);

      for (const sourceItem of [...sourceItems].toSorted(
        (left, right) =>
          left.capturedAt.localeCompare(right.capturedAt) ||
          left.bundleId.localeCompare(right.bundleId),
      )) {
        const detail = await this.source.detail(sourceItem.bundleId);
        const preparedArtifacts = [];
        for (const artifact of detail.artifacts.filter((entry) => entry.state === "Present")) {
          const opened = await this.source.openArtifact(sourceItem.bundleId, artifact.role);
          const objectId = crypto.randomUUID();
          const prepared = await this.artifacts.prepare({
            vaultId,
            objectId,
            rootKey,
            plaintext: chunks(opened.stream),
          });
          preparedArtifactObjectIds.push(objectId);
          preparedArtifacts.push({
            object: prepared.object,
            reference: {
              ...opened.reference,
              artifactObjectId: objectId,
              plaintextByteLength: prepared.plaintextByteLength,
              plaintextChecksum: prepared.plaintextChecksum,
            },
          });
        }
        const bundleId = crypto.randomUUID();
        const descriptorObjectId = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        const assignedCollectionId = collectionId(sourceItem.assignedCollectionId);
        const registration = await prepareCaptureRegistration({
          rootKey,
          vaultId,
          deviceId,
          commandId: crypto.randomUUID(),
          bundleId,
          descriptorObjectId,
          eventId,
          collectionId: assignedCollectionId,
          capturedAt: sourceItem.capturedAt,
          metadata: detail.metadata,
          artifacts: preparedArtifacts,
          warnings: sourceItem.warnings,
          clientVersion: this.clientVersion,
        });
        objects.push(...registration.objects);
        events.push(registration.event);
        const newItem: LibraryItemV1 = {
          version: 1,
          bundleId,
          descriptorObjectId,
          assignedCollectionId,
          title: sourceItem.title,
          originalUrl: sourceItem.originalUrl,
          capturedAt: sourceItem.capturedAt,
          artifactRoles: preparedArtifacts
            .map((entry) => entry.reference.role as ArtifactRole)
            .toSorted(),
          status: "Active",
          warnings: sourceItem.warnings,
        };
        newItems.push(newItem);
        newItemBySourceBundle.set(sourceItem.bundleId, newItem);
      }

      let timestampOffset = 0;
      const sourceTopology = await this.source.topology();
      let forkTopology: CollectionTopologyEventV1[] = [];
      for (const merge of currentMerges(sourceTopology)) {
        const eventId = crypto.randomUUID();
        const fact = {
          eventId,
          eventType: "CollectionsMerged" as const,
          destinationCollectionId: collectionId(merge.destinationCollectionId),
          sourceCollectionIds: merge.sourceCollectionIds.map(collectionId).toSorted(),
        };
        const prepared = await prepareCollectionOperation({
          rootKey,
          vaultId,
          deviceId,
          eventId,
          timestamp: after(latest, timestampOffset++),
          items: newItems,
          topology: forkTopology,
          fact,
        });
        events.push(prepared.event);
        forkTopology = [...forkTopology, fact];
      }
      const deleted = sourceItems
        .map((sourceItem) => ({
          sourceItem,
          forkItem: newItemBySourceBundle.get(sourceItem.bundleId),
        }))
        .filter(
          (pair): pair is { sourceItem: LibraryItemV1; forkItem: LibraryItemV1 } =>
            pair.sourceItem.status === "Deleted" && pair.forkItem !== undefined,
        )
        .map((pair) => pair.forkItem);
      if (deleted.length > 0) {
        const prepared = await prepareLibraryStateChange({
          rootKey,
          vaultId,
          deviceId,
          eventId: crypto.randomUUID(),
          timestamp: after(latest, timestampOffset++),
          operation: "Delete",
          items: deleted,
        });
        events.push(prepared.event);
      }

      const head = {
        ...records.head,
        appendedObjectIds: objects.map((object) => object.objectId).toSorted(),
        appendedEventIds: events.map((event) => event.eventId).toSorted(),
      };
      const prepared: PreparedRemoteReplica = {
        generation: records.generation,
        head,
        events,
        objects,
        preparedArtifactObjectIds,
      };
      const verified = await verifyPreparedRemoteReplica({
        vaultId,
        prepared,
        rootKey,
        artifacts: this.artifacts,
      });
      const byObject = new Map(verified.objects.map((object) => [object.objectId, object]));
      const projections = await new LibraryProjectionRebuilder(
        {
          listStoredEvents: () => Promise.resolve(verified.events),
          getStoredObject: (objectId) => Promise.resolve(byObject.get(objectId)),
          replaceLibraryProjections: () => Promise.resolve(),
        },
        rootKey,
        vaultId,
        this.artifacts,
      ).prepare(new AbortController().signal);
      return {
        records: { ...records, head: verified.head },
        rootKey,
        name,
        events: verified.events,
        objects: verified.objects,
        libraryProjections: projections.itemProjections,
        collectionProjection: projections.collectionProjection,
        vaultNameProjection: projections.vaultNameProjection,
        preparedArtifactObjectIds,
      };
    } catch (error) {
      await Promise.all(
        preparedArtifactObjectIds.map((objectId) =>
          this.artifacts.remove(vaultId, objectId).catch(() => undefined),
        ),
      );
      throw error;
    }
  }
}
