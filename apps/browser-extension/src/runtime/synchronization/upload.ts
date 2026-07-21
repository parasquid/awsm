import type {
  StoredEvent,
  StoredObjectV1,
  SynchronizationCheckpointV1,
  SynchronizationJobV1,
} from "../../drivers/indexeddb/schema";
import { bytesToBase64Url } from "../account/wire";
import type { ArtifactStore } from "../artifact";
import { UploadTransfer } from "./upload-transfer";

interface UploadStateRepository {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
  synchronizationCheckpoint(
    vaultId: string,
    kind: "Object" | "Event",
    entityId: string,
  ): Promise<SynchronizationCheckpointV1 | undefined>;
  saveSynchronizationCheckpoint(checkpoint: SynchronizationCheckpointV1): Promise<void>;
}

interface UploadSource {
  listStoredObjects(): Promise<readonly StoredObjectV1[]>;
  listStoredEvents(): Promise<readonly StoredEvent[]>;
}

interface UploadTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  putTransfer(url: string, part: number, bytes: Uint8Array): Promise<void>;
}

interface UploadArtifactAvailability {
  isArtifactRemoteOnly(vaultId: string, artifactObjectId: string): Promise<boolean>;
}

export interface UploadFaults {
  readonly beforeArtifactRead?: () => Promise<void>;
  readonly afterUploadPart?: () => Promise<void>;
}

async function checksum(bytes: Uint8Array): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
  );
}

async function* bytesStream(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

export class UploadRunner {
  private readonly transfer: UploadTransfer;

  constructor(
    private readonly state: UploadStateRepository,
    private readonly source: UploadSource,
    private readonly artifacts: Pick<ArtifactStore, "openEncrypted">,
    private readonly transport: UploadTransport,
    private readonly beforeEventCommits?: () => Promise<void>,
    private readonly commitEvents = true,
    private readonly afterEventCommit?: (body: unknown) => Promise<void>,
    private readonly availability?: UploadArtifactAvailability,
    private readonly faults?: UploadFaults,
  ) {
    this.transfer = new UploadTransfer(state, transport, faults?.afterUploadPart);
  }

  async run(now = new Date().toISOString()): Promise<void> {
    const loaded = await this.state.latestSynchronizationJob();
    if (
      loaded?.vaultId === undefined ||
      loaded.generationId === undefined ||
      loaded.generationNumber === undefined
    )
      return;
    let job: SynchronizationJobV1 & {
      vaultId: string;
      generationId: string;
      generationNumber: number;
    } = {
      ...loaded,
      vaultId: loaded.vaultId,
      generationId: loaded.generationId,
      generationNumber: loaded.generationNumber,
    };
    if (job.stage === "UploadObjects") {
      const objects = (await this.source.listStoredObjects()).toSorted((left, right) =>
        left.objectId.localeCompare(right.objectId),
      );
      for (const object of objects) {
        await this.uploadObject(job, object);
        job = { ...job, state: "Running", completedItems: job.completedItems + 1, updatedAt: now };
        await this.state.saveSynchronizationJob(job);
      }
      job = { ...job, stage: "CommitEvents", updatedAt: now };
      await this.state.saveSynchronizationJob(job);
    }
    if (job.stage === "CommitEvents") {
      const events = (await this.source.listStoredEvents()).toSorted((left, right) =>
        left.orderingTimestamp === right.orderingTimestamp
          ? left.eventId.localeCompare(right.eventId)
          : left.orderingTimestamp.localeCompare(right.orderingTimestamp),
      );
      for (const event of events) {
        await this.uploadEventDurable(job, event);
        job = { ...job, state: "Running", completedItems: job.completedItems + 1, updatedAt: now };
        await this.state.saveSynchronizationJob(job);
      }
      await this.beforeEventCommits?.();
      if (this.commitEvents) for (const event of events) await this.commitEvent(job, event);
      await this.state.saveSynchronizationJob({
        ...job,
        state: "Running",
        stage: "FetchChanges",
        updatedAt: now,
      });
    }
  }

  private async uploadObject(
    job: SynchronizationJobV1 & { vaultId: string; generationId: string; generationNumber: number },
    object: StoredObjectV1,
  ): Promise<void> {
    const stream =
      object.objectType === "BundleDescriptor"
        ? bytesStream(object.envelopeBytes)
        : this.artifactStream(job.vaultId, object.objectId);
    const byteLength =
      object.objectType === "BundleDescriptor"
        ? object.envelopeBytes.byteLength
        : object.envelopeByteLength;
    const sha256 =
      object.objectType === "BundleDescriptor"
        ? await checksum(object.envelopeBytes)
        : bytesToBase64Url(object.envelopeChecksum);
    await this.transfer.upload(
      job,
      "Object",
      object.objectId,
      object.objectType,
      byteLength,
      sha256,
      stream,
    );
  }

  private async uploadEventDurable(
    job: SynchronizationJobV1 & { vaultId: string; generationId: string; generationNumber: number },
    event: StoredEvent,
  ): Promise<void> {
    await this.transfer.upload(
      job,
      "Event",
      event.eventId,
      "Event",
      event.envelopeBytes.byteLength,
      await checksum(event.envelopeBytes),
      bytesStream(event.envelopeBytes),
      {
        orderingTimestamp: event.orderingTimestamp,
        dependencyObjectIds: [...event.referencedObjectIds].toSorted(),
      },
    );
  }

  private async commitEvent(
    job: SynchronizationJobV1 & { vaultId: string; generationId: string; generationNumber: number },
    event: StoredEvent,
  ): Promise<void> {
    const checkpoint = await this.state.synchronizationCheckpoint(
      job.vaultId,
      "Event",
      event.eventId,
    );
    if (checkpoint === undefined || checkpoint.commitIdempotencyKey === undefined)
      throw Object.assign(new Error("Event upload checkpoint is unavailable"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    if (checkpoint.state !== "Committed") {
      const response = await this.transport.request(
        "POST",
        `/api/vaults/${job.vaultId}/commits`,
        {
          generationId: job.generationId,
          generationNumber: job.generationNumber,
          eventObjectId: event.eventId,
          dependencyObjectIds: [...event.referencedObjectIds].toSorted(),
        },
        checkpoint.commitIdempotencyKey,
      );
      await this.afterEventCommit?.(response.body);
      await this.state.saveSynchronizationCheckpoint({ ...checkpoint, state: "Committed" });
    }
  }

  private async *artifactStream(
    vaultId: string,
    artifactObjectId: string,
  ): AsyncIterable<Uint8Array> {
    await this.faults?.beforeArtifactRead?.();
    if (await this.availability?.isArtifactRemoteOnly(vaultId, artifactObjectId))
      throw Object.assign(new Error("The server requested bytes for a remote-only Artifact."), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    const reader = (await this.artifacts.openEncrypted(vaultId, artifactObjectId)).getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
