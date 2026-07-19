import { describe, expect, it, vi } from "vitest";

import { EnrollmentRunner } from "../../src/runtime/synchronization/runner";

describe("synchronization enrollment runner", () => {
  it("attaches and completes Generation zero before advancing to Object upload", async () => {
    const job = {
      version: 1 as const,
      jobId: "01900000-0000-7000-8000-000000000040",
      accountId: "01900000-0000-7000-8000-000000000041",
      vaultId: "01900000-0000-7000-8000-000000000042",
      generationId: "01900000-0000-7000-8000-000000000043",
      generationNumber: 0,
      state: "Created" as const,
      stage: "EnrollVault" as const,
      createdAt: "2026-07-19T21:00:00.000Z",
      updatedAt: "2026-07-19T21:00:00.000Z",
      snapshotCursor: 0,
      completedItems: 0,
      totalItems: 1,
      processedBytes: 0,
      totalBytes: 3,
      retryCount: 0,
      attachIdempotencyKey: "01900000-0000-7000-8000-000000000044",
    };
    const saveSynchronizationJob = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: { vaults: [] } })
      .mockResolvedValueOnce({
        status: 201,
        body: {
          upload: {
            uploadId: "01900000-0000-7000-8000-000000000045",
            partSizeBytes: 3,
            partCount: 1,
          },
          ticket: { url: "/api/transfers/ticket/parts/{partNumber}" },
        },
      })
      .mockResolvedValueOnce({ status: 200, body: {} })
      .mockResolvedValueOnce({ status: 200, body: {} });
    const putTransfer = vi.fn(async () => undefined);
    const runner = new EnrollmentRunner(
      {
        latestSynchronizationJob: async () => job,
        loadAccountVault: async () => ({
          version: 1,
          accountId: job.accountId,
          vaultId: job.vaultId,
          accountKeyId: "01900000-0000-7000-8000-000000000046",
          accountSlot: { version: 1 },
          remoteGenerationId: job.generationId,
          remoteGenerationNumber: 0,
          deliveryCursor: 0,
        }),
        saveSynchronizationJob,
      },
      {
        load: async () => ({
          generation: {
            version: 1,
            generationId: job.generationId,
            generationNumber: 0,
            envelopeBytes: new Uint8Array([1, 2, 3]),
          },
        }),
      } as never,
      { request, putTransfer },
    );

    await runner.run("2026-07-19T21:01:00.000Z");

    expect(putTransfer).toHaveBeenCalledWith(
      "/api/transfers/ticket/parts/{partNumber}",
      0,
      new Uint8Array([1, 2, 3]),
    );
    expect(request.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ["GET", "/api/vaults"],
      ["POST", "/api/vaults"],
      ["POST", `/api/vaults/${job.vaultId}/uploads/01900000-0000-7000-8000-000000000045/complete`],
      ["POST", `/api/vaults/${job.vaultId}/complete`],
    ]);
    expect(saveSynchronizationJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "Running", stage: "UploadObjects", completedItems: 1 }),
    );
  });
});
