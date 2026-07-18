import {
  type AtomicRegistrationV1,
  IndexedDbDriver,
  IndexedDbVaultRepository,
  type StoredObjectV1,
} from "../../../src/drivers/indexeddb";
import type { VaultRecordsV1 } from "../../../src/runtime/vault/contracts";

function id(suffix: string): string {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

function object(objectId: string, byte: number): StoredObjectV1 {
  return {
    version: 1,
    objectId,
    objectType: "Bundle",
    envelopeBytes: new Uint8Array([byte]),
  };
}

function registration(seed: number): AtomicRegistrationV1 {
  return {
    object: object(id(String(seed)), seed),
    event: {
      version: 1,
      eventId: id(String(seed + 100)),
      objectId: id(String(seed + 200)),
      orderingTimestamp: "2026-07-16T17:00:00.000Z",
      envelopeBytes: new Uint8Array([seed + 1]),
    },
    projection: {
      version: 1,
      bundleId: id(String(seed + 300)),
      envelopeBytes: new Uint8Array([seed + 2]),
    },
    outcome: {
      version: 1,
      commandId: id(String(seed + 400)),
      status: "Succeeded",
      bundleId: id(String(seed + 300)),
      bundleObjectId: id(String(seed)),
      eventId: id(String(seed + 100)),
    },
  };
}

async function seedHead(driver: IndexedDbDriver): Promise<void> {
  await driver.getVaultHead();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(driver.databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction("vault_head", "readwrite");
  transaction.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: id("992"),
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
    "active",
  );
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
  database.close();
}

async function vaultScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const repository = new IndexedDbVaultRepository(databaseName);
  const deviceKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
  const records: VaultRecordsV1 = {
    metadata: {
      version: 1,
      vaultId: id("1"),
      deviceId: id("2"),
      createdAt: "2026-07-16T17:00:00.000Z",
      manuallyLocked: false,
      verifier: {
        version: 1,
        nonce: new Uint8Array(24),
        ciphertext: new Uint8Array(38),
      },
    },
    deviceSlot: {
      version: 1,
      slotId: id("3"),
      vaultId: id("1"),
      deviceId: id("2"),
      algorithm: "wrap:aes-kw-256:device:v1",
      wrappedRootKey: new Uint8Array(40),
    },
    deviceKey,
    generation: {
      version: 1,
      generationId: id("4"),
      generationNumber: 0,
      envelopeBytes: new Uint8Array([1]),
    },
    head: {
      version: 1,
      vaultId: id("1"),
      generationId: id("4"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
  };
  await repository.create(records);
  await repository.setManualLock(true);
  const loaded = await repository.load();
  await repository.deleteDatabase();
  return {
    deviceKeyExtractable: loaded?.deviceKey.extractable,
    wrappedRootKeyBytes: loaded?.deviceSlot.wrappedRootKey.byteLength,
    manuallyLocked: loaded?.metadata.manuallyLocked,
  };
}

async function immutableScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  const record = object(id("1"), 7);
  await driver.putImmutableObject(record);
  await driver.putImmutableObject(record);
  let conflictId = "";
  try {
    await driver.putImmutableObject(object(id("1"), 8));
  } catch (error) {
    conflictId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  const counts = await driver.counts();
  await driver.deleteDatabase();
  return { conflictId, objectCount: counts.objects };
}

async function atomicScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  const input = registration(1);
  const first = await driver.commitRegistration(input);
  const duplicate = await driver.commitRegistration(input);
  const counts = await driver.counts();
  const head = await driver.getVaultHead();
  await driver.deleteDatabase();
  return {
    first,
    duplicate,
    counts,
    appendedObjects: head?.appendedObjectIds.length,
    appendedEvents: head?.appendedEventIds.length,
  };
}

async function rollbackScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  const first = registration(1);
  await driver.commitRegistration(first);
  const second = registration(2);
  const conflicting: AtomicRegistrationV1 = {
    ...second,
    event: { ...second.event, eventId: first.event.eventId },
  };
  let errorId = "";
  try {
    await driver.commitRegistration(conflicting);
  } catch (error) {
    errorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  const rolledBackObject = await driver.hasObject(second.object.objectId);
  const counts = await driver.counts();
  const head = await driver.getVaultHead();
  await driver.deleteDatabase();
  return {
    errorId,
    rolledBackObject,
    counts,
    appendedObjects: head?.appendedObjectIds.length,
    appendedEvents: head?.appendedEventIds.length,
  };
}

async function projectionScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  await driver.commitRegistration(registration(1));
  await driver.clearLibraryProjection();
  const counts = await driver.counts();
  await driver.deleteDatabase();
  return counts;
}

async function interruptionScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  const beforeCommit = registration(1);
  const afterCommit = registration(2);
  await driver.saveCaptureJob({
    version: 1,
    jobId: id("701"),
    commandId: beforeCommit.outcome.commandId,
    tabId: 7,
    state: "Running",
    stage: "MHTML",
    createdAt: "2026-07-16T17:00:00.000Z",
    updatedAt: "2026-07-16T17:00:01.000Z",
  });
  await driver.saveCaptureJob({
    version: 1,
    jobId: id("702"),
    commandId: afterCommit.outcome.commandId,
    tabId: 8,
    state: "Running",
    stage: "Commit",
    createdAt: "2026-07-16T17:00:00.000Z",
    updatedAt: "2026-07-16T17:00:02.000Z",
  });
  await driver.commitRegistration(afterCommit);
  await driver.reconcileInterruptedJobs("2026-07-16T17:01:00.000Z");
  const result = {
    beforeCommit: await driver.getCaptureJob(id("701")),
    afterCommit: await driver.getCaptureJob(id("702")),
  };
  await driver.deleteDatabase();
  return result;
}

async function dismissalScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  const jobId = id("801");
  await driver.saveCaptureJob({
    version: 1,
    jobId,
    commandId: id("802"),
    tabId: 7,
    state: "Succeeded",
    stage: "Commit",
    createdAt: "2026-07-16T17:00:00.000Z",
    updatedAt: "2026-07-16T17:00:01.000Z",
  });
  await driver.dismissCaptureNotice(jobId);
  const dismissed = await driver.getCaptureJob(jobId);
  await driver.deleteDatabase();
  return dismissed;
}

async function libraryStateScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  const first = registration(1);
  const second = registration(2);
  await driver.commitRegistration(first);
  await driver.commitRegistration(second);
  await driver.commitLibraryState(
    {
      version: 1,
      eventId: id("901"),
      objectId: second.object.objectId,
      orderingTimestamp: "2026-07-16T18:00:00.000Z",
      envelopeBytes: new Uint8Array([9]),
    },
    [
      { ...first.projection, envelopeBytes: new Uint8Array([7]) },
      { ...second.projection, envelopeBytes: new Uint8Array([8]) },
    ],
  );
  const result = {
    counts: await driver.counts(),
    firstObject: await driver.hasObject(first.object.objectId),
    secondObject: await driver.hasObject(second.object.objectId),
  };
  await driver.deleteDatabase();
  return result;
}

async function vacuumRollbackScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const driver = new IndexedDbDriver(databaseName);
  await seedHead(driver);
  const input = registration(1);
  await driver.commitRegistration(input);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const corrupt = database.transaction(
    ["command_outcomes", "vault_head", "vacuum_jobs"],
    "readwrite",
  );
  corrupt.objectStore("command_outcomes").put({ invalid: true }, "corrupt");
  corrupt.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: id("992"),
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [input.object.objectId],
      appendedEventIds: [input.event.eventId],
    },
    "active",
  );
  corrupt.objectStore("vacuum_jobs").put(
    {
      version: 1,
      jobId: id("989"),
      sourceGenerationId: id("990"),
      stage: "Preflight",
      createdAt: "2026-07-16T18:00:00.000Z",
    },
    id("989"),
  );
  await new Promise<void>((resolve, reject) => {
    corrupt.addEventListener("complete", () => resolve(), { once: true });
    corrupt.addEventListener("error", () => reject(corrupt.error), { once: true });
  });
  database.close();
  let failed = false;
  try {
    await driver.commitVacuum({
      jobId: id("989"),
      objectIds: [input.object.objectId],
      eventIds: [input.event.eventId],
      eventsToAdd: [],
      bundleIds: [input.projection.bundleId],
      expectedGenerationId: id("990"),
      generation: {
        version: 1,
        generationId: id("991"),
        generationNumber: 1,
        envelopeBytes: new Uint8Array([1]),
      },
      head: {
        version: 1,
        vaultId: id("992"),
        generationId: id("991"),
        generationNumber: 1,
        appendedObjectIds: [],
        appendedEventIds: [],
      },
    });
  } catch {
    failed = true;
  }
  const result = {
    failed,
    objectRetained: await driver.hasObject(input.object.objectId),
    counts: await driver.counts(),
  };
  await driver.deleteDatabase();
  return result;
}

async function vacuumCasConflictScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const driver = new IndexedDbDriver(databaseName);
  await seedHead(driver);
  const input = registration(1);
  await driver.commitRegistration(input);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction(["vault_head", "vacuum_jobs"], "readwrite");
  transaction.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: id("992"),
      generationId: id("990"),
      generationNumber: 2,
      appendedObjectIds: [input.object.objectId],
      appendedEventIds: [input.event.eventId],
    },
    "active",
  );
  transaction.objectStore("vacuum_jobs").put(
    {
      version: 1,
      jobId: id("988"),
      sourceGenerationId: id("989"),
      stage: "Preflight",
      createdAt: "2026-07-16T18:00:00.000Z",
    },
    id("988"),
  );
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
  database.close();
  let failed = false;
  try {
    await driver.commitVacuum({
      jobId: id("988"),
      objectIds: [input.object.objectId],
      eventIds: [input.event.eventId],
      eventsToAdd: [],
      bundleIds: [input.projection.bundleId],
      expectedGenerationId: id("989"),
      generation: {
        version: 1,
        generationId: id("991"),
        generationNumber: 2,
        envelopeBytes: new Uint8Array([1]),
      },
      head: {
        version: 1,
        vaultId: id("992"),
        generationId: id("991"),
        generationNumber: 2,
        appendedObjectIds: [],
        appendedEventIds: [],
      },
    });
  } catch {
    failed = true;
  }
  const result = {
    failed,
    objectRetained: await driver.hasObject(input.object.objectId),
    activeGenerationId: (await driver.getVaultHead())?.generationId,
  };
  await driver.deleteDatabase();
  return result;
}

async function vacuumLeaseScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(driver.databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction("vault_head", "readwrite");
  transaction.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: id("992"),
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
    "active",
  );
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
  database.close();
  await driver.acquireVacuum(id("989"), "2026-07-16T18:00:00.000Z");
  let blocked = false;
  try {
    await driver.commitRegistration(registration(1));
  } catch {
    blocked = true;
  }
  await driver.reconcileInterruptedVacuum();
  await driver.commitRegistration(registration(1));
  const result = { blocked, committedAfterRecovery: await driver.hasObject(id("1")) };
  await driver.deleteDatabase();
  return result;
}

async function collectionOperationScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`);
  await seedHead(driver);
  const first = registration(1);
  const second = registration(2);
  await driver.commitRegistration(first);
  await driver.commitRegistration(second);
  const event = {
    version: 1 as const,
    eventId: id("850"),
    objectId: first.object.objectId,
    orderingTimestamp: "2026-07-18T12:00:00.000Z",
    envelopeBytes: new Uint8Array([8, 5, 0]),
  };
  await driver.commitCollectionOperation({
    event,
    projections: [
      {
        version: 1,
        bundleId: first.projection.bundleId,
        envelopeBytes: new Uint8Array([8, 5, 1]),
      },
    ],
    collectionProjection: {
      version: 1,
      projectionId: id("992"),
      envelopeBytes: new Uint8Array([8, 5, 2]),
    },
  });
  const rebuiltTopology = {
    version: 1 as const,
    projectionId: id("992"),
    envelopeBytes: new Uint8Array([9, 9, 2]),
  };
  await driver.clearLibraryProjection();
  await driver.replaceLibraryProjections([first.projection, second.projection], rebuiltTopology);
  const result = {
    counts: await driver.counts(),
    topologyStored: (await driver.getCollectionProjection())?.projectionId,
    appendedEvents: (await driver.getVaultHead())?.appendedEventIds.length,
  };
  await driver.deleteDatabase();
  return result;
}

async function run(): Promise<void> {
  const scenario = new URL(location.href).searchParams.get("scenario");
  const result =
    scenario === "vault"
      ? await vaultScenario()
      : scenario === "immutable"
        ? await immutableScenario()
        : scenario === "atomic"
          ? await atomicScenario()
          : scenario === "rollback"
            ? await rollbackScenario()
            : scenario === "projection"
              ? await projectionScenario()
              : scenario === "interruption"
                ? await interruptionScenario()
                : scenario === "dismissal"
                  ? await dismissalScenario()
                  : scenario === "library-state"
                    ? await libraryStateScenario()
                    : scenario === "vacuum-rollback"
                      ? await vacuumRollbackScenario()
                      : scenario === "vacuum-cas-conflict"
                        ? await vacuumCasConflictScenario()
                        : scenario === "vacuum-lease"
                          ? await vacuumLeaseScenario()
                          : scenario === "collection-operation"
                            ? await collectionOperationScenario()
                            : { error: "unknown scenario" };
  const output = document.querySelector("#result");
  if (output !== null) {
    output.textContent = JSON.stringify(result);
    output.setAttribute("data-complete", "true");
  }
}

void run().catch((error: unknown) => {
  const output = document.querySelector("#result");
  if (output !== null) {
    output.textContent = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
    output.setAttribute("data-complete", "true");
  }
});
