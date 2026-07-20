import { expect, test } from "@playwright/test";

async function scenario(page: import("@playwright/test").Page, name: string): Promise<unknown> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`/?scenario=${name}`);
  const output = page.locator("#result");
  try {
    await expect(output).toHaveAttribute("data-complete", "true");
  } catch (error) {
    throw new Error(`Harness did not complete: ${errors.join(" | ")}`, {
      cause: error,
    });
  }
  return JSON.parse(await output.innerText());
}

test("persists a non-exportable device key and Vault records", async ({ page }) => {
  await expect(scenario(page, "vault")).resolves.toEqual({
    deviceKeyExtractable: false,
    wrappedRootKeyBytes: 40,
    manuallyLocked: true,
  });
});

test("restores encrypted Account credentials and erases only Account state on logout", async ({
  page,
}) => {
  await expect(scenario(page, "account-persistence")).resolves.toEqual({
    email: "reader@example.test",
    accountKeyRestored: true,
    refreshRestored: true,
    accountWrappingKeyExtractable: false,
    sessionKeyExtractable: false,
    signedOut: true,
    retainedEmail: "reader@example.test",
    localObjectCount: 1,
  });
});

test("isolates active and candidate Account credentials across logout and restart", async ({
  page,
}) => {
  await expect(scenario(page, "account-scope-isolation")).resolves.toEqual({
    activeEmail: "active@example.test",
    candidateEmail: "candidate@example.test",
    activePresentBeforeLogout: true,
    candidatePresentBeforeLogout: true,
    activePresentAfterLogout: false,
    candidatePresentAfterLogout: true,
    candidateKeyRestored: true,
    candidateRefreshRestored: true,
    candidateVaultId: "00000000-0000-4000-8000-000000000834",
    candidatePresentAfterErase: false,
  });
});

test("persists strict restart-safe Server Switch Jobs and scoped checkpoints", async ({ page }) => {
  await expect(scenario(page, "server-switch-persistence")).resolves.toEqual({
    direction: "FastForwardCandidate",
    checkpointState: "Durable",
    staleDeleteRejected: true,
    matchingDeleteSucceeded: true,
    jobRemoved: true,
    checkpointRemoved: true,
    corruptJobRejected: true,
    repeatedStagesStable: true,
    startupDecisions: [
      "PresentAuthentication",
      "Compare",
      "ApplyRemote",
      "CompleteRemoteActivation",
      "ApplyLocal",
      "ApplyLocal",
      "PromoteUnchangedLocal",
      "RevokePriorSession",
      "CleanupSuccess",
    ],
    reopenedStages: [
      "AuthenticationRequired:AuthenticateCandidate",
      "Running:Compare",
      "Running:PrepareRemote",
      "Running:ActivateRemote",
      "Running:PrepareLocal",
      "WaitingForUnlock:ActivateLocal",
      "Running:PromoteContext",
      "Running:RevokePriorSession",
      "Succeeded:Terminal",
    ],
  });
});

test("atomically promotes candidate Account authority and retains prior revocation credentials", async ({
  page,
}) => {
  await expect(scenario(page, "server-switch-promotion")).resolves.toEqual({
    serverOrigin: "https://candidate.example",
    activeEmail: "candidate@example.test",
    activeRefresh: "refresh-candidate@example.test",
    priorEmail: "source@example.test",
    priorRefresh: "refresh-source@example.test",
    candidateRemoved: true,
    registrationAccountId: "00000000-0000-4000-8000-000000000850",
    synchronizationStage: "FetchChanges",
    synchronizationCursor: 21,
    switchStage: "RevokePriorSession",
  });
});

test("rolls back every authoritative store write during Replica promotion", async ({ page }) => {
  const result = (await scenario(page, "server-switch-replica-promotion-atomicity")) as {
    successAtomic: boolean;
    failurePoints: number;
    allAtomic: boolean;
  };
  expect(result.successAtomic).toBe(true);
  expect(result.failurePoints).toBeGreaterThan(20);
  expect(result.allAtomic).toBe(true);
});

test("isolates Vault metadata, key slots, device keys, generations, and heads", async ({
  page,
}) => {
  await expect(scenario(page, "vault-record-isolation")).resolves.toEqual({
    firstVaultId: "00000000-0000-4000-8000-000000000001",
    secondVaultId: "00000000-0000-4000-8000-000000000101",
    firstLocked: true,
    secondLocked: false,
  });
});

test("bootstraps one Workspace and structured-clones its non-exportable name key", async ({
  page,
}) => {
  await expect(scenario(page, "workspace")).resolves.toEqual({
    version: 1,
    sameWorkspace: true,
    activeVaultId: null,
    nameKeyExtractable: false,
  });
});

test("creates a named Vault and all Workspace/Vault records in one transaction", async ({
  page,
}) => {
  await expect(scenario(page, "atomic-vault-create")).resolves.toEqual({
    activeMatchesCreated: true,
    name: "Amber Archive",
    eventCount: 1,
    headEventCount: 1,
    directoryHasPlaintextName: false,
  });
});

test("rolls back Vault creation at every canonical store write", async ({ page }) => {
  await expect(scenario(page, "atomic-vault-create-failures")).resolves.toEqual({
    failurePoints: 11,
    allAtomic: true,
  });
});

test("selects the active Vault atomically and manually locks both contexts", async ({ page }) => {
  await expect(scenario(page, "atomic-vault-select")).resolves.toEqual({
    activeIsFirst: true,
    firstLocked: true,
    secondLocked: true,
    staleErrorId: "VAULT_CONTEXT_CHANGED",
    unchangedAfterStaleRequest: true,
    sameTargetStayedUnlocked: true,
    missingErrorId: "VAULT_NOT_FOUND",
    busyErrorId: "VAULT_BUSY",
  });
});

test("rolls back active Vault selection at every canonical store write", async ({ page }) => {
  await expect(scenario(page, "atomic-vault-select-failures")).resolves.toEqual({
    failurePoints: 3,
    allAtomic: true,
  });
});

test("renames the active Vault by atomically replacing name state and appending history", async ({
  page,
}) => {
  const result = await scenario(page, "atomic-vault-rename");
  expect(result).toMatchObject({ name: "Quiet Folio" });
  expect((result as { eventIds: string[] }).eventIds).toHaveLength(2);
  expect((result as { headEventIds: string[] }).headEventIds).toHaveLength(2);
  expect((result as { eventIds: string[] }).eventIds).toEqual(
    (result as { headEventIds: string[] }).headEventIds,
  );
});

test("rolls back Vault Rename at every canonical store write", async ({ page }) => {
  await expect(scenario(page, "atomic-vault-rename-failures")).resolves.toEqual({
    failurePoints: 4,
    allAtomic: true,
  });
});

test("accepts identical immutable Objects and rejects conflicting bytes", async ({ page }) => {
  await expect(scenario(page, "immutable")).resolves.toEqual({
    conflictId: "IMMUTABLE_OBJECT_CONFLICT",
    objectCount: 1,
  });
});

test("isolates colliding Object IDs and counts by Vault prefix", async ({ page }) => {
  await expect(scenario(page, "vault-isolation")).resolves.toEqual({
    firstByte: 7,
    secondByte: 8,
    firstCounts: { objects: 1, events: 0, projections: 0, outcomes: 0 },
    secondCounts: { objects: 1, events: 0, projections: 0, outcomes: 0 },
  });
});

test("isolates colliding Capture Job IDs and rejects mismatched stored Vault identity", async ({
  page,
}) => {
  await expect(scenario(page, "capture-job-vault-isolation")).resolves.toEqual({
    firstTabId: 7,
    secondTabId: 8,
    mismatchedReadRejected: true,
  });
});

test("rejects an Event whose declared Vault differs from the scoped Driver", async ({ page }) => {
  await expect(scenario(page, "event-vault-mismatch")).resolves.toEqual({
    rejected: true,
    counts: { objects: 0, events: 0, projections: 0, outcomes: 0 },
  });
});

test("commits registration atomically and idempotently", async ({ page }) => {
  const result = await scenario(page, "atomic");
  expect(result).toMatchObject({
    appendedObjects: 2,
    appendedEvents: 1,
    counts: {
      objects: 2,
      events: 1,
      projections: 1,
      outcomes: 1,
    },
  });
});

test("rolls back an Object when a later Event write conflicts", async ({ page }) => {
  const result = await scenario(page, "rollback");
  expect(result).toMatchObject({
    errorId: "STORAGE_TRANSACTION_FAILED",
    rolledBackObject: false,
    appendedObjects: 2,
    appendedEvents: 1,
    counts: {
      objects: 2,
      events: 1,
      projections: 1,
      outcomes: 1,
    },
  });
});

test("clears rebuildable Projection rows without deleting Objects", async ({ page }) => {
  await expect(scenario(page, "projection")).resolves.toMatchObject({
    objects: 2,
    projections: 0,
  });
});

test("reconciles interrupted jobs around the atomic commit boundary", async ({ page }) => {
  await expect(scenario(page, "interruption")).resolves.toMatchObject({
    beforeCommit: { state: "Failed", errorId: "CAPTURE_INTERRUPTED" },
    afterCommit: { state: "Succeeded" },
  });
});

test("persists dismissal of a completed recent-capture notice", async ({ page }) => {
  await expect(scenario(page, "dismissal")).resolves.toMatchObject({
    state: "Succeeded",
    noticeDismissed: true,
  });
});

test("atomically changes grouped Projection rows while retaining immutable Objects", async ({
  page,
}) => {
  await expect(scenario(page, "library-state")).resolves.toEqual({
    counts: { objects: 4, events: 3, projections: 2, outcomes: 2 },
    firstObject: true,
    secondObject: true,
  });
});

test("rolls back every Vacuum deletion when the transaction fails", async ({ page }) => {
  await expect(scenario(page, "vacuum-rollback")).resolves.toEqual({
    failed: true,
    objectRetained: true,
    counts: { objects: 2, events: 1, projections: 1, outcomes: 2 },
  });
});

test("activates nothing when the source Vault Generation changed", async ({ page }) => {
  await expect(scenario(page, "vacuum-cas-conflict")).resolves.toEqual({
    failed: true,
    objectRetained: true,
    activeGenerationId: "00000000-0000-4000-8000-000000000990",
  });
});

test("blocks writes while Vacuum owns the Vault and recovers an abandoned pre-activation lease", async ({
  page,
}) => {
  await expect(scenario(page, "vacuum-lease")).resolves.toEqual({
    blocked: true,
    committedAfterRecovery: true,
  });
});

test("retains synchronized Vacuum remote and local activation checkpoints across restart", async ({
  page,
}) => {
  await expect(scenario(page, "synchronized-vacuum-journal")).resolves.toEqual({
    remoteIntentStage: "ActivateRemote",
    candidateGenerationId: "00000000-0000-4000-8000-000000000985",
    localPendingStage: "ActivateLocal",
    activatedHeadCursor: 17,
    discarded: true,
  });
});

test("atomically commits a Collection Event, item rows, topology, and generation tail", async ({
  page,
}) => {
  await expect(scenario(page, "collection-operation")).resolves.toEqual({
    counts: { objects: 4, events: 3, projections: 2, outcomes: 2 },
    topologyStored: "00000000-0000-4000-8000-000000000992",
    appendedEvents: 3,
  });
});

test("reports scoped management activity and rejects Vacuum while Capture runs", async ({
  page,
}) => {
  await expect(scenario(page, "management-busy")).resolves.toEqual({
    captureBusy: "Capture",
    vacuumWhileCaptureErrorId: "VAULT_BUSY",
    vacuumBusy: "Vacuum",
  });
});

test("holds an exclusive Export lease, releases it on cancellation, and reconciles interruption", async ({
  page,
}) => {
  await expect(scenario(page, "export-lease")).resolves.toEqual({
    busy: "Export",
    inactiveErrorId: "VAULT_CONTEXT_CHANGED",
    lockedErrorId: "VAULT_LOCKED",
    registrationBlocked: true,
    captureBlocked: true,
    vacuumBlocked: true,
    committedAfterCancellation: true,
    reconciled: true,
    interruptedState: "Failed",
    interruptedErrorId: "EXPORT_INTERRUPTED",
  });
});

test("holds one Workspace Import lease and fences Vault mutations", async ({ page }) => {
  await expect(scenario(page, "import-lease")).resolves.toEqual({
    stage: "Acquire",
    busy: true,
    secondErrorId: "VAULT_BUSY",
    captureBlocked: true,
    registrationBlocked: true,
    vacuumBlocked: true,
    exportBlocked: true,
    lockBlocked: true,
    busyAfterCancellation: false,
  });
});

test("persists the complete Import Job lifecycle and reconciles interruption", async ({ page }) => {
  await expect(scenario(page, "import-job-lifecycle")).resolves.toEqual({
    regressiveProgressErrorId: "STORAGE_TRANSACTION_FAILED",
    oversizedProgressErrorId: "STORAGE_TRANSACTION_FAILED",
    prematureStagingErrorId: "STORAGE_TRANSACTION_FAILED",
    authenticateStage: "Authenticate",
    retryState: "Created",
    runningStage: "Validate",
    preparedEntries: 2,
    regressiveExecutionErrorId: "STORAGE_TRANSACTION_FAILED",
    cancelledState: "Cancelled",
    repeatedCancellationState: "Cancelled",
    reconciled: true,
    interruptedState: "Failed",
    interruptedErrorId: "IMPORT_INTERRUPTED",
    busyAfterInterruption: false,
  });
});

test("atomically activates an imported Vault and rejects destination collisions", async ({
  page,
}) => {
  await expect(scenario(page, "atomic-vault-import")).resolves.toEqual({
    selectedInEmptyWorkspace: true,
    importedLocked: true,
    eventCount: 1,
    objectCount: 1,
    projectionCount: 1,
    jobState: "Succeeded",
    collisionErrorId: "VAULT_ALREADY_EXISTS",
    directoryCountAfterCollision: 1,
    rollbackFailurePoints: 14,
    rollbackAlwaysAtomic: true,
  });
});

test("atomically replaces a stale Replica and activates an independent local recovery fork", async ({
  page,
}) => {
  await expect(scenario(page, "atomic-stale-recovery")).resolves.toEqual({
    rollbackFailurePoints: 23,
    rollbackAlwaysAtomic: true,
    originalUsesServerGeneration: true,
    originalEventIds: ["00000000-0000-4000-8000-000000000851"],
    forkGenerationIndependent: true,
    forkEventIds: ["00000000-0000-4000-8000-000000000870"],
    directoryContainsBoth: true,
    jobState: "Succeeded",
  });
});

test("rejects remote reconciliation that races or omits local authority", async ({ page }) => {
  await expect(scenario(page, "remote-reconciliation-fence")).resolves.toEqual({
    omissionErrorId: "VAULT_CONTEXT_CHANGED",
    changedHeadErrorId: "VAULT_CONTEXT_CHANGED",
    localMutationPreserved: true,
    jobStillRunning: true,
  });
});

test("reconciles every interrupted stale-recovery stage after an IndexedDB restart", async ({
  page,
}) => {
  const recovered = {
    reconciled: true,
    state: "Conflict",
    stage: "Checkpoint",
    forkRemoved: true,
    artifactsRemoved: true,
  };
  await expect(scenario(page, "stale-recovery-restart")).resolves.toEqual({
    PrepareRecoveryFork: recovered,
    PrepareServerReplacement: recovered,
    ActivateRecovery: recovered,
  });
});

test("streams encrypted Artifact wrappers through scoped OPFS storage", async ({ page }) => {
  await expect(scenario(page, "artifact-store")).resolves.toEqual({
    objectType: "Artifact",
    rootKeyExtractable: false,
    ciphertextExcludesPlaintext: true,
    recovered: "known plaintext artifact",
    collisionRejected: true,
    orphanRemoved: true,
    encryptedImportCopiedExactly: true,
    encryptedImportReplaySucceeded: true,
    corruptEncryptedImportRejected: true,
    quotaErrorId: "STORAGE_QUOTA_EXCEEDED",
    quotaArtifactRemoved: true,
  });
});

test("stages an encrypted Vault Package through bounded OPFS streaming", async ({ page }) => {
  await expect(scenario(page, "import-source-staging")).resolves.toEqual({
    storedBytes: 700000,
    finalProgress: 700000,
    progressMonotonic: true,
    bytesMatch: true,
    cleanupRemoved: true,
    quotaErrorId: "STORAGE_QUOTA_EXCEEDED",
    quotaSourceRemoved: true,
  });
});
