export interface ServerSwitchGeneration {
  readonly generationId: string;
  readonly generationNumber: number;
  readonly predecessorGenerationId?: string;
}

export interface VerifiedServerSwitchReplica {
  readonly vaultId: string;
  readonly generation: ServerSwitchGeneration;
}

export type ServerSwitchRecoveryProof =
  | { readonly state: "Exact" }
  | { readonly state: "Different" }
  | { readonly state: "Unavailable" }
  | { readonly state: "IntegrityFailure" };

export interface ServerSwitchClassificationInput {
  readonly local: VerifiedServerSwitchReplica;
  readonly candidate?: VerifiedServerSwitchReplica;
  readonly rootKeysEqual: boolean;
  readonly immutableIntersectionEqual: boolean;
  readonly sourceRecovery?: ServerSwitchRecoveryProof;
  readonly candidateRecovery?: ServerSwitchRecoveryProof;
}

export type ServerSwitchClassification =
  | {
      readonly kind: "Direction";
      readonly direction: "PublishLocal" | "Union" | "FastForwardCandidate" | "FastForwardLocal";
    }
  | {
      readonly kind: "Conflict";
      readonly errorId: "SERVER_SWITCH_CONFLICT";
      readonly reason: "AncestryUnavailable" | "DivergedGeneration";
    }
  | {
      readonly kind: "Failure";
      readonly errorId: "SERVER_SWITCH_VAULT_MISMATCH" | "SYNCHRONIZATION_INTEGRITY_FAILED";
    };

const integrityFailure: ServerSwitchClassification = {
  kind: "Failure",
  errorId: "SYNCHRONIZATION_INTEGRITY_FAILED",
};

function classifyDirectSuccessor(
  successor: ServerSwitchGeneration,
  predecessor: ServerSwitchGeneration,
  recovery: ServerSwitchRecoveryProof | undefined,
  direction: "FastForwardCandidate" | "FastForwardLocal",
): ServerSwitchClassification {
  if (successor.generationNumber !== predecessor.generationNumber + 1) return integrityFailure;
  switch (recovery?.state) {
    case "Exact":
      return { kind: "Direction", direction };
    case "Different":
      return {
        kind: "Conflict",
        errorId: "SERVER_SWITCH_CONFLICT",
        reason: "DivergedGeneration",
      };
    case "IntegrityFailure":
      return integrityFailure;
    case "Unavailable":
    case undefined:
      return {
        kind: "Conflict",
        errorId: "SERVER_SWITCH_CONFLICT",
        reason: "AncestryUnavailable",
      };
  }
}

export function classifyServerSwitch(
  input: ServerSwitchClassificationInput,
): ServerSwitchClassification {
  if (input.candidate === undefined) return { kind: "Direction", direction: "PublishLocal" };
  if (input.candidate.vaultId !== input.local.vaultId)
    return { kind: "Failure", errorId: "SERVER_SWITCH_VAULT_MISMATCH" };
  if (!input.rootKeysEqual || !input.immutableIntersectionEqual) return integrityFailure;

  const local = input.local.generation;
  const candidate = input.candidate.generation;
  if (local.generationId === candidate.generationId) {
    if (local.generationNumber !== candidate.generationNumber) return integrityFailure;
    return { kind: "Direction", direction: "Union" };
  }

  if (local.predecessorGenerationId === candidate.generationId)
    return classifyDirectSuccessor(local, candidate, input.sourceRecovery, "FastForwardCandidate");
  if (candidate.predecessorGenerationId === local.generationId)
    return classifyDirectSuccessor(candidate, local, input.candidateRecovery, "FastForwardLocal");

  if (
    local.predecessorGenerationId !== undefined &&
    local.predecessorGenerationId === candidate.predecessorGenerationId
  )
    return {
      kind: "Conflict",
      errorId: "SERVER_SWITCH_CONFLICT",
      reason: "DivergedGeneration",
    };

  return {
    kind: "Conflict",
    errorId: "SERVER_SWITCH_CONFLICT",
    reason: "AncestryUnavailable",
  };
}
