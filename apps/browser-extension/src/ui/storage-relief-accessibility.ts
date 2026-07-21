import type { StorageReliefJobView } from "../app/storage-relief-protocol";

function terminal(job: StorageReliefJobView): boolean {
  return job.state === "Succeeded" || job.state === "Failed" || job.state === "Cancelled";
}

export function storageReliefAnnouncement(
  previous: StorageReliefJobView | undefined,
  current: StorageReliefJobView | undefined,
): string | undefined {
  if (current === undefined) return undefined;
  if (previous?.jobId !== current.jobId)
    return current.state === "Running" ? `Storage cleanup started. ${current.stage}.` : undefined;
  if (!previous.cancellationRequested && current.cancellationRequested)
    return "Cancelling storage cleanup.";
  if (!terminal(previous) && terminal(current)) {
    if (current.state === "Cancelled") return "Storage cleanup cancelled.";
    if (current.state === "Succeeded")
      return `Device storage reduction completed. ${String(current.freedArtifacts)} files were removed.`;
    return `Storage cleanup stopped safely. Nothing unverified was removed (${current.errorId ?? "unexpected failure"}).`;
  }
  if (previous.stage !== current.stage) return `Storage cleanup: ${current.stage}.`;
  if (
    previous.verifiedArtifacts !== current.verifiedArtifacts ||
    previous.freedArtifacts !== current.freedArtifacts ||
    previous.skippedArtifacts !== current.skippedArtifacts
  )
    return `Device storage progress: ${String(current.verifiedArtifacts)} of ${String(current.candidateArtifacts)} files checked; ${String(current.freedArtifacts)} removed.`;
  return undefined;
}

export function storageReliefFocusTarget(
  previous: StorageReliefJobView | undefined,
  current: StorageReliefJobView | undefined,
): "action" | "heading" | undefined {
  if (
    previous === undefined ||
    current === undefined ||
    previous.jobId !== current.jobId ||
    terminal(previous) ||
    !terminal(current)
  )
    return undefined;
  return current.state === "Succeeded" ? "heading" : "action";
}
