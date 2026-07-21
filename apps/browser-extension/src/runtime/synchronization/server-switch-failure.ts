import type { ServerSwitchJobV1 } from "../../drivers/indexeddb/schema";

const UNCOMMITTED_STAGES = new Set<ServerSwitchJobV1["stage"]>([
  "Compare",
  "PrepareRemote",
  "ActivateRemote",
  "PrepareLocal",
  "ActivateLocal",
]);

export function shouldFailUncommittedServerSwitch(
  job: ServerSwitchJobV1 | undefined,
): job is ServerSwitchJobV1 {
  return (
    job?.state === "Running" && !job.candidateAuthorityChanged && UNCOMMITTED_STAGES.has(job.stage)
  );
}
