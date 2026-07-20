import { wipe } from "../../crypto/sodium";
import type { StoredAccountMetadataV1, StoredAccountVaultV1 } from "../../drivers/indexeddb/schema";
import { openAccountVaultSlot } from "../account/crypto";
import { decodeAccountVaultSlot } from "./discovery";
import type { VerifiedServerSwitchReplica } from "./server-switch-classifier";

interface CandidateAccountStore {
  loadMetadata(scope: "server-switch-candidate"): Promise<StoredAccountMetadataV1 | undefined>;
  loadAccountEncryptionKey(scope: "server-switch-candidate"): Promise<Uint8Array>;
}

interface CandidateTransport {
  request(
    method: string,
    path: string,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

export interface CandidateInspection {
  readonly replica?: VerifiedServerSwitchReplica;
  readonly registration?: StoredAccountVaultV1;
  readonly headCursor: number;
}

function integrity(message: string): Error {
  return Object.assign(new Error(message), { id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw integrity(`${field} is invalid`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw integrity(`${field} is invalid`);
  return value;
}

function counter(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw integrity(`${field} is invalid`);
  return value;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export class ServerSwitchCandidateInspector {
  constructor(
    private readonly accounts: CandidateAccountStore,
    private readonly transport: CandidateTransport,
  ) {}

  async inspect(expectedVaultId: string, localRootKey: Uint8Array): Promise<CandidateInspection> {
    const metadata = await this.accounts.loadMetadata("server-switch-candidate");
    if (metadata === undefined) throw integrity("Candidate Account metadata is missing");
    const response = record(
      (await this.transport.request("GET", "/api/vaults")).body,
      "Vault list",
    );
    if (!Array.isArray(response.vaults) || response.vaults.length > 1)
      throw integrity("Candidate Account Vault cardinality is invalid");
    if (response.vaults.length === 0) return { headCursor: 0 };
    const remote = record(response.vaults[0], "Candidate Vault");
    const vaultId = text(remote.vaultId, "Candidate Vault ID");
    if (vaultId !== expectedVaultId)
      throw Object.assign(new Error("Candidate Account owns another Vault"), {
        id: "SERVER_SWITCH_VAULT_MISMATCH",
      });
    if (remote.state !== "Active") throw integrity("Candidate Vault is not active");
    const generationId = text(remote.generationId, "Candidate Generation ID");
    const generationNumber = counter(remote.generationNumber, "Candidate Generation number");
    const headCursor = counter(remote.headCursor, "Candidate head cursor");
    const predecessorGenerationId =
      remote.predecessorGenerationId === undefined
        ? undefined
        : text(remote.predecessorGenerationId, "Candidate predecessor Generation ID");
    const slot = decodeAccountVaultSlot(remote.accountSlot);
    if (slot.vaultId !== vaultId || slot.accountKeyId !== metadata.accountKeyId)
      throw integrity("Candidate Account slot identity differs");
    const accountKey = await this.accounts.loadAccountEncryptionKey("server-switch-candidate");
    let remoteRootKey: Uint8Array | undefined;
    try {
      remoteRootKey = await openAccountVaultSlot(slot, accountKey);
      if (!equal(remoteRootKey, localRootKey)) throw integrity("Candidate Vault Root Key differs");
    } finally {
      await wipe(accountKey);
      if (remoteRootKey !== undefined) await wipe(remoteRootKey);
    }
    return {
      replica: {
        vaultId,
        generation: {
          generationId,
          generationNumber,
          ...(predecessorGenerationId === undefined ? {} : { predecessorGenerationId }),
        },
      },
      registration: {
        version: 1,
        accountId: metadata.accountId,
        vaultId,
        accountKeyId: metadata.accountKeyId,
        accountSlot: remote.accountSlot,
        remoteGenerationId: generationId,
        remoteGenerationNumber: generationNumber,
        deliveryCursor: headCursor,
      },
      headCursor,
    };
  }
}
