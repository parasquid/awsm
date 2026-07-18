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

test("accepts identical immutable Objects and rejects conflicting bytes", async ({ page }) => {
  await expect(scenario(page, "immutable")).resolves.toEqual({
    conflictId: "IMMUTABLE_OBJECT_CONFLICT",
    objectCount: 1,
  });
});

test("commits registration atomically and idempotently", async ({ page }) => {
  const result = await scenario(page, "atomic");
  expect(result).toMatchObject({
    appendedObjects: 1,
    appendedEvents: 1,
    counts: {
      objects: 1,
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
    appendedObjects: 1,
    appendedEvents: 1,
    counts: {
      objects: 1,
      events: 1,
      projections: 1,
      outcomes: 1,
    },
  });
});

test("clears rebuildable Projection rows without deleting Objects", async ({ page }) => {
  await expect(scenario(page, "projection")).resolves.toMatchObject({
    objects: 1,
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
    counts: { objects: 2, events: 3, projections: 2, outcomes: 2 },
    firstObject: true,
    secondObject: true,
  });
});

test("rolls back every Vacuum deletion when the transaction fails", async ({ page }) => {
  await expect(scenario(page, "vacuum-rollback")).resolves.toEqual({
    failed: true,
    objectRetained: true,
    counts: { objects: 1, events: 1, projections: 1, outcomes: 2 },
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
    counts: { objects: 2, events: 3, projections: 2, outcomes: 2 },
    topologyStored: "00000000-0000-4000-8000-000000000992",
    appendedEvents: 3,
  });
});
