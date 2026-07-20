import type { ServerSwitchJobV1 } from "../../drivers/indexeddb/schema";

export type ServerSwitchStartupDecision =
  | "PresentAuthentication"
  | "CleanupFailure"
  | "CleanupSuccess"
  | "WaitForUnlock"
  | "Compare"
  | "ApplyRemote"
  | "CompleteRemoteActivation"
  | "ApplyLocal"
  | "PromoteUnchangedLocal"
  | "RevokePriorSession";

export function serverSwitchStartupDecision(
  job: ServerSwitchJobV1,
  vaultUnlocked: boolean,
): ServerSwitchStartupDecision {
  if (job.state === "AuthenticationRequired") return "PresentAuthentication";
  if (job.state === "Conflict" || job.state === "Failed") return "CleanupFailure";
  if (job.state === "Succeeded") return "CleanupSuccess";
  if (!vaultUnlocked) return "WaitForUnlock";
  if (job.stage === "Compare") return "Compare";
  if (job.stage === "PrepareRemote") return "ApplyRemote";
  if (job.stage === "ActivateRemote") return "CompleteRemoteActivation";
  if (job.stage === "PrepareLocal" || job.stage === "ActivateLocal") return "ApplyLocal";
  if (job.stage === "PromoteContext")
    return job.direction === "Union" || job.direction === "FastForwardLocal"
      ? "ApplyLocal"
      : "PromoteUnchangedLocal";
  if (job.stage === "RevokePriorSession") return "RevokePriorSession";
  throw Object.assign(new Error("Server Switch startup state is invalid"), {
    id: "SYNCHRONIZATION_INTEGRITY_FAILED",
  });
}
