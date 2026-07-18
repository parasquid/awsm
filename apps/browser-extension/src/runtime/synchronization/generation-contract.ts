import { integer, literal, record, uuid } from "../../domain/validation";

export interface GenerationFenceV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly generationId: string;
  readonly generationNumber: number;
}

export function decodeGenerationFence(value: unknown): GenerationFenceV1 {
  const input = record(value, "generationFence");
  return {
    version: literal(input.version, 1, "generationFence.version"),
    vaultId: uuid(input.vaultId, "generationFence.vaultId"),
    generationId: uuid(input.generationId, "generationFence.generationId"),
    generationNumber: integer(input.generationNumber, "generationFence.generationNumber"),
  };
}

export function generationSubmissionOutcome(
  submitted: GenerationFenceV1,
  active: GenerationFenceV1,
): "ACCEPTED" | "VAULT_GENERATION_SUPERSEDED" {
  return submitted.vaultId === active.vaultId &&
    submitted.generationId === active.generationId &&
    submitted.generationNumber === active.generationNumber
    ? "ACCEPTED"
    : "VAULT_GENERATION_SUPERSEDED";
}

export function supersededBackupRecoveryMode(
  backup: GenerationFenceV1,
  active: GenerationFenceV1,
): "MERGE" | "ISOLATED_RECOVERY" {
  return generationSubmissionOutcome(backup, active) === "ACCEPTED" ? "MERGE" : "ISOLATED_RECOVERY";
}
