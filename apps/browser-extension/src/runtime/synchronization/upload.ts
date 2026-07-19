import type {
  StoredEvent,
  StoredObjectV1,
  SynchronizationCheckpointV1,
  SynchronizationJobV1,
} from "../../drivers/indexeddb/schema";
import { bytesToBase64Url } from "../account/wire";
import type { ArtifactStore } from "../artifact";

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

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Object.assign(new Error("Synchronization response is invalid"), {
      id: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
  return value as Record<string, unknown>;
}

async function checksum(bytes: Uint8Array): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
  );
}

async function* bytesStream(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function readPart(
  iterator: AsyncIterator<Uint8Array>,
  pending: Uint8Array,
  partSize: number,
): Promise<{ readonly bytes: Uint8Array; readonly pending: Uint8Array; readonly done: boolean }> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let remainder = pending;
  while (length < partSize) {
    if (remainder.byteLength === 0) {
      const next = await iterator.next();
      if (next.done) break;
      remainder = next.value;
    }
    const take = Math.min(partSize - length, remainder.byteLength);
    chunks.push(remainder.subarray(0, take));
    length += take;
    remainder = remainder.subarray(take);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, pending: remainder, done: length === 0 };
}

export class UploadRunner {
  constructor(
    private readonly state: UploadStateRepository,
    private readonly source: UploadSource,
    private readonly artifacts: Pick<ArtifactStore, "openEncrypted">,
    private readonly transport: UploadTransport,
  ) {}

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
        await this.uploadEvent(job, event);
        job = { ...job, state: "Running", completedItems: job.completedItems + 1, updatedAt: now };
        await this.state.saveSynchronizationJob(job);
      }
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
        : this.stream(this.artifacts.openEncrypted(job.vaultId, object.objectId));
    const byteLength =
      object.objectType === "BundleDescriptor"
        ? object.envelopeBytes.byteLength
        : object.envelopeByteLength;
    const sha256 =
      object.objectType === "BundleDescriptor"
        ? await checksum(object.envelopeBytes)
        : bytesToBase64Url(object.envelopeChecksum);
    await this.upload(
      job,
      "Object",
      object.objectId,
      object.objectType,
      byteLength,
      sha256,
      stream,
    );
  }

  private async uploadEvent(
    job: SynchronizationJobV1 & { vaultId: string; generationId: string; generationNumber: number },
    event: StoredEvent,
  ): Promise<void> {
    const checkpoint = await this.upload(
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
    if (checkpoint.state !== "Committed") {
      await this.transport.request(
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
      await this.state.saveSynchronizationCheckpoint({ ...checkpoint, state: "Committed" });
    }
  }

  private async upload(
    job: SynchronizationJobV1 & { vaultId: string; generationId: string; generationNumber: number },
    kind: "Object" | "Event",
    entityId: string,
    objectType: "BundleDescriptor" | "Artifact" | "Event",
    byteLength: number,
    sha256: string,
    bytes: AsyncIterable<Uint8Array>,
    eventMetadata?: {
      readonly orderingTimestamp: string;
      readonly dependencyObjectIds: readonly string[];
    },
  ): Promise<SynchronizationCheckpointV1> {
    let checkpoint = await this.state.synchronizationCheckpoint(job.vaultId, kind, entityId);
    checkpoint ??= {
      version: 1,
      vaultId: job.vaultId,
      entityId,
      kind,
      state: "Prepared",
      createIdempotencyKey: crypto.randomUUID(),
      completeIdempotencyKey: crypto.randomUUID(),
      ...(kind === "Event" ? { commitIdempotencyKey: crypto.randomUUID() } : {}),
      receivedParts: [],
    };
    if (checkpoint.state === "Durable" || checkpoint.state === "Committed") return checkpoint;
    await this.state.saveSynchronizationCheckpoint(checkpoint);
    const response = record(
      (
        await this.transport.request(
          "POST",
          `/api/vaults/${job.vaultId}/uploads`,
          {
            objectId: entityId,
            objectType,
            byteLength,
            sha256,
            targetGenerationId: job.generationId,
            ...(eventMetadata === undefined ? {} : { eventMetadata }),
          },
          checkpoint.createIdempotencyKey,
        )
      ).body,
    );
    const upload = record(response.upload);
    const ticket = record(response.ticket);
    if (
      typeof upload.uploadId !== "string" ||
      typeof upload.partSizeBytes !== "number" ||
      !Array.isArray(upload.receivedParts) ||
      typeof ticket.url !== "string"
    )
      throw Object.assign(new Error("Upload response is invalid"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    checkpoint = {
      ...checkpoint,
      state: "Uploading",
      uploadId: upload.uploadId,
      receivedParts: upload.receivedParts.map(Number),
    };
    await this.state.saveSynchronizationCheckpoint(checkpoint);
    if (upload.state !== "Completed" && upload.state !== "AlreadyDurable") {
      const iterator = bytes[Symbol.asyncIterator]();
      let pending = new Uint8Array();
      for (let part = 0; ; part += 1) {
        const next = await readPart(iterator, pending, upload.partSizeBytes);
        pending = Uint8Array.from(next.pending);
        if (next.done) break;
        if (!checkpoint.receivedParts.includes(part))
          await this.transport.putTransfer(ticket.url, part, next.bytes);
      }
      await this.transport.request(
        "POST",
        `/api/vaults/${job.vaultId}/uploads/${upload.uploadId}/complete`,
        undefined,
        checkpoint.completeIdempotencyKey,
      );
    }
    checkpoint = { ...checkpoint, state: "Durable" };
    await this.state.saveSynchronizationCheckpoint(checkpoint);
    return checkpoint;
  }

  private async *stream(input: Promise<ReadableStream<Uint8Array>>): AsyncIterable<Uint8Array> {
    const reader = (await input).getReader();
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
