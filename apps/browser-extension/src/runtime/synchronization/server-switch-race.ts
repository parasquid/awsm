import type { ServerSwitchJobV1 } from "../../drivers/indexeddb/schema";

export type ServerSwitchRaceDisposition =
  | { readonly kind: "Recompare" }
  | { readonly kind: "Conflict"; readonly candidateAuthorityChanged: boolean };

export function serverSwitchRaceDisposition(
  job: ServerSwitchJobV1 | undefined,
  errorId: string,
): ServerSwitchRaceDisposition | undefined {
  if (
    job?.state !== "Running" ||
    (errorId !== "VAULT_HEAD_CHANGED" && errorId !== "VAULT_GENERATION_SUPERSEDED")
  )
    return undefined;
  if (!job.candidateAuthorityChanged && job.retryCount === 0) return { kind: "Recompare" };
  return { kind: "Conflict", candidateAuthorityChanged: job.candidateAuthorityChanged };
}
