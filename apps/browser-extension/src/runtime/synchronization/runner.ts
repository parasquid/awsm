import type { StoredAccountVaultV1, SynchronizationJobV1 } from "../../drivers/indexeddb/schema";
import { bytesToBase64Url } from "../account/wire";
import type { VaultRecordsV1 } from "../vault/contracts";

interface EnrollmentJobRepository {
  latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined>;
  loadAccountVault(): Promise<StoredAccountVaultV1 | undefined>;
  saveSynchronizationJob(job: SynchronizationJobV1): Promise<void>;
}

interface EnrollmentVaultRepository {
  load(vaultId: string): Promise<VaultRecordsV1 | undefined>;
}

interface EnrollmentTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  putTransfer(url: string, part: number, bytes: Uint8Array): Promise<void>;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Object.assign(new Error(`${field} is invalid`), {
      id: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
  return value as Record<string, unknown>;
}

export class EnrollmentRunner {
  constructor(
    private readonly jobs: EnrollmentJobRepository,
    private readonly vaults: EnrollmentVaultRepository,
    private readonly transport: EnrollmentTransport,
  ) {}

  async run(now = new Date().toISOString()): Promise<void> {
    const job = await this.jobs.latestSynchronizationJob();
    if (job === undefined || job.state === "Succeeded" || job.stage !== "EnrollVault") return;
    if (job.vaultId === undefined || job.generationId === undefined)
      throw Object.assign(new Error("Enrollment Job context is incomplete"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    const [registration, records] = await Promise.all([
      this.jobs.loadAccountVault(),
      this.vaults.load(job.vaultId),
    ]);
    if (
      registration === undefined ||
      records === undefined ||
      registration.vaultId !== job.vaultId ||
      records.generation.generationId !== job.generationId
    )
      throw Object.assign(new Error("Enrollment identity changed"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });

    await this.jobs.saveSynchronizationJob({ ...job, state: "Running", updatedAt: now });
    const listed = object((await this.transport.request("GET", "/api/vaults")).body, "Vault list");
    if (!Array.isArray(listed.vaults))
      throw Object.assign(new Error("Vault list is invalid"), {
        id: "SYNCHRONIZATION_INTEGRITY_FAILED",
      });
    if (listed.vaults.length === 0) {
      const generationBytes = records.generation.envelopeBytes;
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", Uint8Array.from(generationBytes)),
      );
      const attached = object(
        (
          await this.transport.request(
            "POST",
            "/api/vaults",
            {
              vaultId: job.vaultId,
              generationId: job.generationId,
              generationNumber: records.generation.generationNumber,
              accountSlot: registration.accountSlot,
              generationObject: {
                objectId: job.generationId,
                objectType: "VaultGeneration",
                byteLength: generationBytes.byteLength,
                sha256: bytesToBase64Url(digest),
              },
            },
            job.attachIdempotencyKey,
          )
        ).body,
        "Vault attachment",
      );
      const upload = object(attached.upload, "Vault attachment upload");
      const ticket = object(attached.ticket, "Vault attachment ticket");
      if (
        typeof upload.uploadId !== "string" ||
        typeof upload.partSizeBytes !== "number" ||
        !Number.isSafeInteger(upload.partSizeBytes) ||
        upload.partSizeBytes <= 0 ||
        typeof ticket.url !== "string"
      )
        throw Object.assign(new Error("Vault attachment transfer is invalid"), {
          id: "SYNCHRONIZATION_INTEGRITY_FAILED",
        });
      for (let part = 0; part * upload.partSizeBytes < generationBytes.byteLength; part += 1) {
        const first = part * upload.partSizeBytes;
        await this.transport.putTransfer(
          ticket.url,
          part,
          generationBytes.subarray(
            first,
            Math.min(first + upload.partSizeBytes, generationBytes.byteLength),
          ),
        );
      }
      await this.transport.request(
        "POST",
        `/api/vaults/${job.vaultId}/uploads/${upload.uploadId}/complete`,
        undefined,
        crypto.randomUUID(),
      );
      await this.transport.request(
        "POST",
        `/api/vaults/${job.vaultId}/complete`,
        { generationId: job.generationId },
        crypto.randomUUID(),
      );
    } else {
      const remote = object(listed.vaults[0], "Account Vault");
      if (remote.vaultId !== job.vaultId)
        throw Object.assign(new Error("Account Vault identity differs"), {
          id: "SYNCHRONIZATION_CONFLICT",
        });
    }

    await this.jobs.saveSynchronizationJob({
      ...job,
      state: "Running",
      stage: "UploadObjects",
      completedItems: 1,
      processedBytes: records.generation.envelopeBytes.byteLength,
      updatedAt: now,
    });
  }
}
