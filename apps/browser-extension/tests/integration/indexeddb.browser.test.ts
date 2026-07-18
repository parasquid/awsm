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
    throw new Error(`Harness did not complete: ${errors.join(" | ")}`, { cause: error });
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

test("streams encrypted Artifact wrappers through scoped OPFS storage", async ({ page }) => {
  await expect(scenario(page, "artifact-store")).resolves.toEqual({
    objectType: "Artifact",
    rootKeyExtractable: false,
    ciphertextExcludesPlaintext: true,
    recovered: "known plaintext artifact",
    collisionRejected: true,
    orphanRemoved: true,
  });
});
