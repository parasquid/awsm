import { describe, expect, it, vi } from "vitest";
import type {
  SynchronizationCheckpointV1,
  SynchronizationJobV1,
} from "../../src/drivers/indexeddb/schema";
import { UploadRunner } from "../../src/runtime/synchronization/upload";

describe("synchronization upload ordering", () => {
  it("makes dependencies durable before publishing the Event closure", async () => {
    let job: SynchronizationJobV1 = {
      version: 1,
      jobId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      vaultId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      generationNumber: 0,
      state: "Running",
      stage: "UploadObjects",
      createdAt: "2026-07-19T21:00:00.000Z",
      updatedAt: "2026-07-19T21:00:00.000Z",
      snapshotCursor: 0,
      completedItems: 1,
      totalItems: 3,
      processedBytes: 3,
      totalBytes: 7,
      retryCount: 0,
      attachIdempotencyKey: crypto.randomUUID(),
    };
    const checkpoints = new Map<string, SynchronizationCheckpointV1>();
    const calls: string[] = [];
    const transport = {
      request: vi.fn(async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        if (path.endsWith("/uploads"))
          return {
            status: 201,
            body: {
              upload: {
                uploadId: crypto.randomUUID(),
                state: "Open",
                partSizeBytes: 1024,
                receivedParts: [],
              },
              ticket: { url: "/api/transfers/token/parts/{partNumber}" },
            },
          };
        return { status: 200, body: {} };
      }),
      putTransfer: vi.fn(async () => undefined),
    };
    const descriptorId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const runner = new UploadRunner(
      {
        latestSynchronizationJob: async () => job,
        saveSynchronizationJob: async (value) => {
          job = value;
        },
        synchronizationCheckpoint: async (_vaultId, kind, entityId) =>
          checkpoints.get(`${kind}:${entityId}`),
        saveSynchronizationCheckpoint: async (value) => {
          checkpoints.set(`${value.kind}:${value.entityId}`, value);
        },
      },
      {
        listStoredObjects: async () => [
          {
            version: 1,
            objectId: descriptorId,
            objectType: "BundleDescriptor",
            envelopeBytes: new Uint8Array([1, 2]),
          },
        ],
        listStoredEvents: async () => [
          {
            version: 1,
            vaultId: job.vaultId as string,
            eventId,
            referencedObjectIds: [descriptorId],
            orderingTimestamp: "2026-07-19T20:00:00.000Z",
            envelopeBytes: new Uint8Array([3, 4]),
          },
        ],
      },
      { openEncrypted: vi.fn() },
      transport,
      async () => {
        calls.push("ACTIVATE");
      },
    );

    await runner.run("2026-07-19T21:01:00.000Z");

    const descriptorComplete = calls.findIndex(
      (call) => call.includes(`uploads/`) && call.endsWith("/complete"),
    );
    const commit = calls.findIndex((call) => call.endsWith("/commits"));
    const activation = calls.indexOf("ACTIVATE");
    const lastDurable = calls.findLastIndex(
      (call) => call.includes("uploads/") && call.endsWith("/complete"),
    );
    expect(descriptorComplete).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(lastDurable);
    expect(commit).toBeGreaterThan(activation);
    expect(checkpoints.get(`Event:${eventId}`)?.state).toBe("Committed");
    expect(job.stage).toBe("FetchChanges");
  });
});
