import {
  type AtomicRegistrationV1,
  IndexedDbDriver,
  IndexedDbVaultRepository,
  IndexedDbWorkspaceRepository,
  type StoredObjectV1,
  vaultKey,
  vaultSingletonKey,
} from "../../../src/drivers/indexeddb";
import {
  encryptWorkspaceVaultName,
  prepareVaultNameChange,
  VaultService,
  WorkspaceService,
} from "../../../src/runtime/vault";
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
      vaultId: "00000000-0000-4000-8000-000000000000",
      eventId: id(String(seed + 100)),
      referencedObjectIds: [id(String(seed + 200))],
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
      vaultId: driver.vaultId,
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
    vaultSingletonKey(driver.vaultId, "active"),
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
  await seedVaultRecords(databaseName, records);
  await repository.setManualLock(records.metadata.vaultId, true);
  const loaded = await repository.load(records.metadata.vaultId);
  await repository.deleteDatabase();
  return {
    deviceKeyExtractable: loaded?.deviceKey.extractable,
    wrappedRootKeyBytes: loaded?.deviceSlot.wrappedRootKey.byteLength,
    manuallyLocked: loaded?.metadata.manuallyLocked,
  };
}

async function makeVaultRecords(seed: number): Promise<VaultRecordsV1> {
  const deviceKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
  const vaultId = id(String(seed));
  const deviceId = id(String(seed + 1));
  const generationId = id(String(seed + 3));
  return {
    metadata: {
      version: 1,
      vaultId,
      deviceId,
      createdAt: "2026-07-16T17:00:00.000Z",
      manuallyLocked: false,
      verifier: { version: 1, nonce: new Uint8Array(24), ciphertext: new Uint8Array(38) },
    },
    deviceSlot: {
      version: 1,
      slotId: id(String(seed + 2)),
      vaultId,
      deviceId,
      algorithm: "wrap:aes-kw-256:device:v1",
      wrappedRootKey: new Uint8Array(40),
    },
    deviceKey,
    generation: {
      version: 1,
      generationId,
      generationNumber: 0,
      envelopeBytes: new Uint8Array([seed]),
    },
    head: {
      version: 1,
      vaultId,
      generationId,
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
  };
}

async function seedVaultRecords(databaseName: string, records: VaultRecordsV1): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction(
    ["vault_metadata", "key_slots", "device_keys", "vault_generations", "vault_head"],
    "readwrite",
  );
  const vaultId = records.metadata.vaultId;
  transaction
    .objectStore("vault_metadata")
    .add(records.metadata, vaultSingletonKey(vaultId, "metadata"));
  transaction
    .objectStore("key_slots")
    .add(records.deviceSlot, vaultSingletonKey(vaultId, "device"));
  transaction
    .objectStore("device_keys")
    .add(records.deviceKey, vaultSingletonKey(vaultId, "device"));
  transaction
    .objectStore("vault_generations")
    .add(records.generation, vaultKey(vaultId, records.generation.generationId));
  transaction.objectStore("vault_head").add(records.head, vaultSingletonKey(vaultId, "active"));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
  database.close();
}

async function vaultRecordIsolationScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const repository = new IndexedDbVaultRepository(databaseName);
  const first = await makeVaultRecords(1);
  const second = await makeVaultRecords(101);
  await seedVaultRecords(databaseName, first);
  await seedVaultRecords(databaseName, second);
  await repository.setManualLock(first.metadata.vaultId, true);
  const firstLoaded = await repository.load(first.metadata.vaultId);
  const secondLoaded = await repository.load(second.metadata.vaultId);
  await repository.deleteDatabase();
  return {
    firstVaultId: firstLoaded?.metadata.vaultId,
    secondVaultId: secondLoaded?.metadata.vaultId,
    firstLocked: firstLoaded?.metadata.manuallyLocked,
    secondLocked: secondLoaded?.metadata.manuallyLocked,
  };
}

async function workspaceScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const repository = new IndexedDbWorkspaceRepository(databaseName);
  const first = await repository.bootstrap("2026-07-18T12:00:00.000Z");
  const second = await repository.bootstrap("2026-07-18T13:00:00.000Z");
  const loaded = await repository.load();
  await repository.deleteDatabase();
  return {
    version: loaded?.metadata.version,
    sameWorkspace: first.metadata.workspaceId === second.metadata.workspaceId,
    activeVaultId: loaded?.metadata.activeVaultId ?? null,
    nameKeyExtractable: loaded?.nameCacheKey.extractable,
  };
}

async function atomicVaultCreateScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
  const workspace = await workspaceRepository.bootstrap("2026-07-18T15:00:00.000Z");
  const vaultRepository = new IndexedDbVaultRepository(databaseName);
  const vaultService = new VaultService(vaultRepository);
  const prepared = await vaultService.prepareCreate({
    name: "Amber Archive",
    createdAt: "2026-07-18T15:01:00.000Z",
  });
  const records = prepared.records;
  const vaultId = records.metadata.vaultId;
  const eventId = id("952");
  const nameChange = await prepareVaultNameChange({
    rootKey: prepared.rootKey,
    eventType: "VaultCreated",
    vaultId,
    deviceId: records.metadata.deviceId,
    eventId,
    timestamp: records.metadata.createdAt,
    name: prepared.name,
  });
  const cache = await encryptWorkspaceVaultName({
    key: workspace.nameCacheKey,
    workspaceId: workspace.metadata.workspaceId,
    vaultId,
    sourceEventId: eventId,
    name: prepared.name,
  });
  await workspaceRepository.commitVaultCreate({
    records,
    event: nameChange.event,
    projection: nameChange.projection,
    cache,
  });
  const state = await new WorkspaceService(workspaceRepository).state({
    unlockedVaultId: vaultId,
  });
  const driver = new IndexedDbDriver(databaseName, vaultId);
  const directory = await workspaceRepository.listVaultDirectory();
  const result = {
    activeMatchesCreated: state.activeVaultId === vaultId,
    name: state.vaults[0]?.name,
    eventCount: (await driver.listStoredEvents()).length,
    headEventCount: (await driver.getVaultHead())?.appendedEventIds.length,
    directoryHasPlaintextName: Object.keys(directory[0] ?? {}).includes("name"),
  };
  await workspaceRepository.close();
  await vaultRepository.close();
  await driver.deleteDatabase();
  return result;
}

async function atomicVaultCreateFailureScenario(): Promise<unknown> {
  const results: boolean[] = [];
  for (let failAt = 1; failAt <= 11; failAt += 1) {
    const databaseName = `awsm-integration-${crypto.randomUUID()}`;
    const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
    const workspace = await workspaceRepository.bootstrap("2026-07-18T16:00:00.000Z");
    const firstVaultId = await prepareAndCommitVault(
      databaseName,
      workspaceRepository,
      "Amber Archive",
      "2026-07-18T16:01:00.000Z",
    );
    const vaultRepository = new IndexedDbVaultRepository(databaseName);
    const prepared = await new VaultService(vaultRepository).prepareCreate({
      name: "Quiet Folio",
      createdAt: "2026-07-18T16:02:00.000Z",
    });
    const secondVaultId = prepared.records.metadata.vaultId;
    const eventId = crypto.randomUUID();
    const nameChange = await prepareVaultNameChange({
      rootKey: prepared.rootKey,
      eventType: "VaultCreated",
      vaultId: secondVaultId,
      deviceId: prepared.records.metadata.deviceId,
      eventId,
      timestamp: "2026-07-18T16:02:00.000Z",
      name: "Quiet Folio",
    });
    const cache = await encryptWorkspaceVaultName({
      key: workspace.nameCacheKey,
      workspaceId: workspace.metadata.workspaceId,
      vaultId: secondVaultId,
      sourceEventId: eventId,
      name: "Quiet Folio",
    });
    const originalAdd = IDBObjectStore.prototype.add;
    const originalPut = IDBObjectStore.prototype.put;
    let write = 0;
    const inject = <T extends typeof originalAdd | typeof originalPut>(original: T) =>
      function (this: IDBObjectStore, ...args: Parameters<T>): IDBRequest<IDBValidKey> {
        write += 1;
        if (write === failAt) throw new DOMException("Injected write failure", "AbortError");
        return original.apply(this, args) as IDBRequest<IDBValidKey>;
      };
    IDBObjectStore.prototype.add = inject(originalAdd);
    IDBObjectStore.prototype.put = inject(originalPut);
    try {
      await workspaceRepository.commitVaultCreate({
        expectedActiveVaultId: firstVaultId,
        records: prepared.records,
        event: nameChange.event,
        projection: nameChange.projection,
        cache,
      });
    } catch {
      // The injected write is expected to abort the complete transaction.
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
      IDBObjectStore.prototype.put = originalPut;
    }
    const [after, directory, first, second] = await Promise.all([
      workspaceRepository.load(),
      workspaceRepository.listVaultDirectory(),
      vaultRepository.load(firstVaultId),
      vaultRepository.load(secondVaultId),
    ]);
    results.push(
      write === failAt &&
        after?.metadata.activeVaultId === firstVaultId &&
        directory.length === 1 &&
        directory[0]?.vaultId === firstVaultId &&
        first?.metadata.manuallyLocked === false &&
        second === undefined,
    );
    await vaultRepository.close();
    await workspaceRepository.deleteDatabase();
  }
  return { failurePoints: results.length, allAtomic: results.every(Boolean) };
}

async function prepareAndCommitVault(
  databaseName: string,
  workspaceRepository: IndexedDbWorkspaceRepository,
  name: string,
  createdAt: string,
  expectedActiveVaultId?: string,
): Promise<string> {
  const workspace = await workspaceRepository.load();
  if (workspace === undefined) throw new Error("Workspace is not initialized.");
  const vaultRepository = new IndexedDbVaultRepository(databaseName);
  const service = new VaultService(vaultRepository);
  const prepared = await service.prepareCreate({ name, createdAt });
  const vaultId = prepared.records.metadata.vaultId;
  const eventId = crypto.randomUUID();
  const nameChange = await prepareVaultNameChange({
    rootKey: prepared.rootKey,
    eventType: "VaultCreated",
    vaultId,
    deviceId: prepared.records.metadata.deviceId,
    eventId,
    timestamp: createdAt,
    name,
  });
  const cache = await encryptWorkspaceVaultName({
    key: workspace.nameCacheKey,
    workspaceId: workspace.metadata.workspaceId,
    vaultId,
    sourceEventId: eventId,
    name,
  });
  await workspaceRepository.commitVaultCreate({
    ...(expectedActiveVaultId === undefined ? {} : { expectedActiveVaultId }),
    records: prepared.records,
    event: nameChange.event,
    projection: nameChange.projection,
    cache,
  });
  await vaultRepository.close();
  return vaultId;
}

async function atomicVaultSelectScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
  await workspaceRepository.bootstrap("2026-07-18T16:00:00.000Z");
  const firstVaultId = await prepareAndCommitVault(
    databaseName,
    workspaceRepository,
    "Amber Archive",
    "2026-07-18T16:01:00.000Z",
  );
  const secondVaultId = await prepareAndCommitVault(
    databaseName,
    workspaceRepository,
    "Quiet Folio",
    "2026-07-18T16:02:00.000Z",
    firstVaultId,
  );
  await workspaceRepository.commitVaultSelect({
    expectedActiveVaultId: secondVaultId,
    vaultId: secondVaultId,
  });
  const vaultRepository = new IndexedDbVaultRepository(databaseName);
  const sameTarget = await vaultRepository.load(secondVaultId);
  let missingErrorId = "";
  try {
    await workspaceRepository.commitVaultSelect({
      expectedActiveVaultId: secondVaultId,
      vaultId: id("999"),
    });
  } catch (error) {
    missingErrorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  const busyDriver = new IndexedDbDriver(databaseName, secondVaultId);
  const busyJob = {
    version: 1 as const,
    vaultId: secondVaultId,
    jobId: id("980"),
    commandId: id("981"),
    tabId: 7,
    state: "Running" as const,
    stage: "MHTML" as const,
    createdAt: "2026-07-18T16:02:00.000Z",
    updatedAt: "2026-07-18T16:02:01.000Z",
  };
  await busyDriver.saveCaptureJob(busyJob);
  let busyErrorId = "";
  try {
    await workspaceRepository.commitVaultSelect({
      expectedActiveVaultId: secondVaultId,
      vaultId: firstVaultId,
    });
  } catch (error) {
    busyErrorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  await busyDriver.saveCaptureJob({ ...busyJob, state: "Succeeded", stage: "Commit" });
  await busyDriver.close();
  await workspaceRepository.commitVaultSelect({
    expectedActiveVaultId: secondVaultId,
    vaultId: firstVaultId,
  });
  const selected = await workspaceRepository.load();
  const first = await vaultRepository.load(firstVaultId);
  const second = await vaultRepository.load(secondVaultId);
  let staleErrorId = "";
  try {
    await workspaceRepository.commitVaultSelect({
      expectedActiveVaultId: secondVaultId,
      vaultId: secondVaultId,
    });
  } catch (error) {
    staleErrorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  const afterStale = await workspaceRepository.load();
  const result = {
    activeIsFirst: selected?.metadata.activeVaultId === firstVaultId,
    firstLocked: first?.metadata.manuallyLocked,
    secondLocked: second?.metadata.manuallyLocked,
    staleErrorId,
    unchangedAfterStaleRequest: afterStale?.metadata.activeVaultId === firstVaultId,
    sameTargetStayedUnlocked: sameTarget?.metadata.manuallyLocked === false,
    missingErrorId,
    busyErrorId,
  };
  await vaultRepository.close();
  await workspaceRepository.deleteDatabase();
  return result;
}

async function atomicVaultSelectFailureScenario(): Promise<unknown> {
  const results: boolean[] = [];
  for (let failAt = 1; failAt <= 3; failAt += 1) {
    const databaseName = `awsm-integration-${crypto.randomUUID()}`;
    const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
    await workspaceRepository.bootstrap("2026-07-18T16:00:00.000Z");
    const firstVaultId = await prepareAndCommitVault(
      databaseName,
      workspaceRepository,
      "Amber Archive",
      "2026-07-18T16:01:00.000Z",
    );
    const secondVaultId = await prepareAndCommitVault(
      databaseName,
      workspaceRepository,
      "Quiet Folio",
      "2026-07-18T16:02:00.000Z",
      firstVaultId,
    );
    const originalPut = IDBObjectStore.prototype.put;
    let write = 0;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalPut>
    ): IDBRequest<IDBValidKey> {
      write += 1;
      if (write === failAt) throw new DOMException("Injected write failure", "AbortError");
      return originalPut.apply(this, args);
    };
    try {
      await workspaceRepository.commitVaultSelect({
        expectedActiveVaultId: secondVaultId,
        vaultId: firstVaultId,
      });
    } catch {
      // Expected injected transaction abort.
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const vaultRepository = new IndexedDbVaultRepository(databaseName);
    const [workspace, first, second] = await Promise.all([
      workspaceRepository.load(),
      vaultRepository.load(firstVaultId),
      vaultRepository.load(secondVaultId),
    ]);
    results.push(
      write === failAt &&
        workspace?.metadata.activeVaultId === secondVaultId &&
        first?.metadata.manuallyLocked === true &&
        second?.metadata.manuallyLocked === false,
    );
    await vaultRepository.close();
    await workspaceRepository.deleteDatabase();
  }
  return { failurePoints: results.length, allAtomic: results.every(Boolean) };
}

async function atomicVaultRenameScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
  const workspace = await workspaceRepository.bootstrap("2026-07-18T17:00:00.000Z");
  const vaultRepository = new IndexedDbVaultRepository(databaseName);
  const service = new VaultService(vaultRepository);
  const created = await service.prepareCreate({
    name: "Amber Archive",
    createdAt: "2026-07-18T17:01:00.000Z",
  });
  const vaultId = created.records.metadata.vaultId;
  const createdEventId = crypto.randomUUID();
  const createdName = await prepareVaultNameChange({
    rootKey: created.rootKey,
    eventType: "VaultCreated",
    vaultId,
    deviceId: created.records.metadata.deviceId,
    eventId: createdEventId,
    timestamp: "2026-07-18T17:01:00.000Z",
    name: "Amber Archive",
  });
  await workspaceRepository.commitVaultCreate({
    records: created.records,
    event: createdName.event,
    projection: createdName.projection,
    cache: await encryptWorkspaceVaultName({
      key: workspace.nameCacheKey,
      workspaceId: workspace.metadata.workspaceId,
      vaultId,
      sourceEventId: createdEventId,
      name: "Amber Archive",
    }),
  });
  const renamedEventId = crypto.randomUUID();
  const renamed = await prepareVaultNameChange({
    rootKey: created.rootKey,
    eventType: "VaultRenamed",
    vaultId,
    deviceId: created.records.metadata.deviceId,
    eventId: renamedEventId,
    timestamp: "2026-07-18T17:02:00.000Z",
    name: "Quiet Folio",
  });
  await workspaceRepository.commitVaultRename({
    expectedActiveVaultId: vaultId,
    vaultId,
    event: renamed.event,
    projection: renamed.projection,
    cache: await encryptWorkspaceVaultName({
      key: workspace.nameCacheKey,
      workspaceId: workspace.metadata.workspaceId,
      vaultId,
      sourceEventId: renamedEventId,
      name: "Quiet Folio",
    }),
  });
  const driver = new IndexedDbDriver(databaseName, vaultId);
  const result = {
    name: await workspaceRepository.readVaultName(
      workspace.nameCacheKey,
      workspace.metadata.workspaceId,
      vaultId,
    ),
    eventIds: (await driver.listStoredEvents()).map((event) => event.eventId),
    headEventIds: (await driver.getVaultHead())?.appendedEventIds,
  };
  await driver.close();
  await vaultRepository.close();
  await workspaceRepository.deleteDatabase();
  return result;
}

async function atomicVaultRenameFailureScenario(): Promise<unknown> {
  const results: boolean[] = [];
  for (let failAt = 1; failAt <= 4; failAt += 1) {
    const databaseName = `awsm-integration-${crypto.randomUUID()}`;
    const workspaceRepository = new IndexedDbWorkspaceRepository(databaseName);
    const workspace = await workspaceRepository.bootstrap("2026-07-18T17:00:00.000Z");
    const vaultRepository = new IndexedDbVaultRepository(databaseName);
    const created = await new VaultService(vaultRepository).prepareCreate({
      name: "Amber Archive",
      createdAt: "2026-07-18T17:01:00.000Z",
    });
    const vaultId = created.records.metadata.vaultId;
    const createdEventId = crypto.randomUUID();
    const createdName = await prepareVaultNameChange({
      rootKey: created.rootKey,
      eventType: "VaultCreated",
      vaultId,
      deviceId: created.records.metadata.deviceId,
      eventId: createdEventId,
      timestamp: "2026-07-18T17:01:00.000Z",
      name: "Amber Archive",
    });
    await workspaceRepository.commitVaultCreate({
      records: created.records,
      event: createdName.event,
      projection: createdName.projection,
      cache: await encryptWorkspaceVaultName({
        key: workspace.nameCacheKey,
        workspaceId: workspace.metadata.workspaceId,
        vaultId,
        sourceEventId: createdEventId,
        name: "Amber Archive",
      }),
    });
    const renamedEventId = crypto.randomUUID();
    const renamed = await prepareVaultNameChange({
      rootKey: created.rootKey,
      eventType: "VaultRenamed",
      vaultId,
      deviceId: created.records.metadata.deviceId,
      eventId: renamedEventId,
      timestamp: "2026-07-18T17:02:00.000Z",
      name: "Quiet Folio",
    });
    const cache = await encryptWorkspaceVaultName({
      key: workspace.nameCacheKey,
      workspaceId: workspace.metadata.workspaceId,
      vaultId,
      sourceEventId: renamedEventId,
      name: "Quiet Folio",
    });
    const originalAdd = IDBObjectStore.prototype.add;
    const originalPut = IDBObjectStore.prototype.put;
    let write = 0;
    const inject = <T extends typeof originalAdd | typeof originalPut>(original: T) =>
      function (this: IDBObjectStore, ...args: Parameters<T>): IDBRequest<IDBValidKey> {
        write += 1;
        if (write === failAt) throw new DOMException("Injected write failure", "AbortError");
        return original.apply(this, args) as IDBRequest<IDBValidKey>;
      };
    IDBObjectStore.prototype.add = inject(originalAdd);
    IDBObjectStore.prototype.put = inject(originalPut);
    try {
      await workspaceRepository.commitVaultRename({
        expectedActiveVaultId: vaultId,
        vaultId,
        event: renamed.event,
        projection: renamed.projection,
        cache,
      });
    } catch {
      // Expected injected transaction abort.
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
      IDBObjectStore.prototype.put = originalPut;
    }
    const driver = new IndexedDbDriver(databaseName, vaultId);
    results.push(
      write === failAt &&
        (await workspaceRepository.readVaultName(
          workspace.nameCacheKey,
          workspace.metadata.workspaceId,
          vaultId,
        )) === "Amber Archive" &&
        (await driver.listStoredEvents()).length === 1 &&
        (await driver.getVaultHead())?.appendedEventIds.length === 1,
    );
    await driver.close();
    await vaultRepository.close();
    await workspaceRepository.deleteDatabase();
  }
  return { failurePoints: results.length, allAtomic: results.every(Boolean) };
}

async function immutableScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
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

async function vaultIsolationScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const first = new IndexedDbDriver(databaseName, id("1"));
  const second = new IndexedDbDriver(databaseName, id("2"));
  const objectId = id("99");
  await first.putImmutableObject(object(objectId, 7));
  await second.putImmutableObject(object(objectId, 8));
  const result = {
    firstByte: (await first.getStoredObject(objectId))?.envelopeBytes[0],
    secondByte: (await second.getStoredObject(objectId))?.envelopeBytes[0],
    firstCounts: await first.counts(),
    secondCounts: await second.counts(),
  };
  await second.close();
  await first.deleteDatabase();
  return result;
}

async function eventVaultMismatchScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("1"));
  await seedHead(driver);
  let rejected = false;
  try {
    await driver.commitRegistration(registration(1));
  } catch {
    rejected = true;
  }
  const counts = await driver.counts();
  await driver.deleteDatabase();
  return { rejected, counts };
}

async function atomicScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
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
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
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
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await seedHead(driver);
  await driver.commitRegistration(registration(1));
  await driver.clearLibraryProjection();
  const counts = await driver.counts();
  await driver.deleteDatabase();
  return counts;
}

async function interruptionScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await seedHead(driver);
  const beforeCommit = registration(1);
  const afterCommit = registration(2);
  await driver.saveCaptureJob({
    version: 1,
    vaultId: driver.vaultId,
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
    vaultId: driver.vaultId,
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
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  const jobId = id("801");
  await driver.saveCaptureJob({
    version: 1,
    vaultId: driver.vaultId,
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

async function captureJobVaultIsolationScenario(): Promise<unknown> {
  const databaseName = `awsm-integration-${crypto.randomUUID()}`;
  const firstVaultId = id("901");
  const secondVaultId = id("902");
  const jobId = id("903");
  const first = new IndexedDbDriver(databaseName, firstVaultId);
  const second = new IndexedDbDriver(databaseName, secondVaultId);
  const base = {
    version: 1 as const,
    jobId,
    commandId: id("904"),
    state: "Succeeded" as const,
    stage: "Commit" as const,
    createdAt: "2026-07-18T14:00:00.000Z",
    updatedAt: "2026-07-18T14:00:01.000Z",
  };
  await first.saveCaptureJob({ ...base, vaultId: firstVaultId, tabId: 7 });
  await second.saveCaptureJob({ ...base, vaultId: secondVaultId, tabId: 8 });
  const firstTabId = (await first.getCaptureJob(jobId))?.tabId;
  const secondTabId = (await second.getCaptureJob(jobId))?.tabId;

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction("capture_jobs", "readwrite");
  transaction
    .objectStore("capture_jobs")
    .put({ ...base, vaultId: secondVaultId, tabId: 9 }, vaultKey(firstVaultId, jobId));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
  database.close();
  let mismatchedReadRejected = false;
  try {
    await first.getCaptureJob(jobId);
  } catch {
    mismatchedReadRejected = true;
  }
  first.close();
  await second.deleteDatabase();
  return { firstTabId, secondTabId, mismatchedReadRejected };
}

async function libraryStateScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await seedHead(driver);
  const first = registration(1);
  const second = registration(2);
  await driver.commitRegistration(first);
  await driver.commitRegistration(second);
  await driver.commitLibraryState(
    {
      version: 1,
      vaultId: driver.vaultId,
      eventId: id("901"),
      referencedObjectIds: [second.object.objectId],
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
  const driver = new IndexedDbDriver(databaseName, id("0"));
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
  corrupt
    .objectStore("command_outcomes")
    .put({ invalid: true }, vaultKey(driver.vaultId, "corrupt"));
  corrupt.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: driver.vaultId,
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [input.object.objectId],
      appendedEventIds: [input.event.eventId],
    },
    vaultSingletonKey(driver.vaultId, "active"),
  );
  corrupt.objectStore("vacuum_jobs").put(
    {
      version: 1,
      jobId: id("989"),
      sourceGenerationId: id("990"),
      stage: "Preflight",
      createdAt: "2026-07-16T18:00:00.000Z",
    },
    vaultKey(driver.vaultId, id("989")),
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
        vaultId: driver.vaultId,
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
  const driver = new IndexedDbDriver(databaseName, id("0"));
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
      vaultId: driver.vaultId,
      generationId: id("990"),
      generationNumber: 2,
      appendedObjectIds: [input.object.objectId],
      appendedEventIds: [input.event.eventId],
    },
    vaultSingletonKey(driver.vaultId, "active"),
  );
  transaction.objectStore("vacuum_jobs").put(
    {
      version: 1,
      jobId: id("988"),
      sourceGenerationId: id("989"),
      stage: "Preflight",
      createdAt: "2026-07-16T18:00:00.000Z",
    },
    vaultKey(driver.vaultId, id("988")),
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
        vaultId: driver.vaultId,
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
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(driver.databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction("vault_head", "readwrite");
  transaction.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: driver.vaultId,
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
    vaultSingletonKey(driver.vaultId, "active"),
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
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await seedHead(driver);
  const first = registration(1);
  const second = registration(2);
  await driver.commitRegistration(first);
  await driver.commitRegistration(second);
  const event = {
    version: 1 as const,
    vaultId: driver.vaultId,
    eventId: id("850"),
    referencedObjectIds: [first.object.objectId],
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
  await driver.replaceLibraryProjections([first.projection, second.projection], rebuiltTopology, {
    version: 1,
    vaultId: driver.vaultId,
    sourceEventId: id("850"),
    envelopeBytes: new Uint8Array([9, 9, 3]),
  });
  const result = {
    counts: await driver.counts(),
    topologyStored: (await driver.getCollectionProjection())?.projectionId,
    appendedEvents: (await driver.getVaultHead())?.appendedEventIds.length,
  };
  await driver.deleteDatabase();
  return result;
}

async function managementBusyScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await seedHead(driver);
  const job = {
    version: 1 as const,
    vaultId: driver.vaultId,
    jobId: id("970"),
    commandId: id("971"),
    tabId: 7,
    state: "Running" as const,
    stage: "MHTML" as const,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:01.000Z",
  };
  await driver.saveCaptureJob(job);
  const captureBusy = await driver.managementBusy();
  let vacuumWhileCaptureErrorId = "";
  try {
    await driver.acquireVacuum(id("972"), "2026-07-18T12:00:02.000Z");
  } catch (error) {
    vacuumWhileCaptureErrorId =
      error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  await driver.saveCaptureJob({ ...job, state: "Succeeded", stage: "Commit" });
  await driver.acquireVacuum(id("973"), "2026-07-18T12:00:03.000Z");
  const vacuumBusy = await driver.managementBusy();
  await driver.deleteDatabase();
  return { captureBusy, vacuumWhileCaptureErrorId, vacuumBusy };
}

async function exportLeaseScenario(): Promise<unknown> {
  const driver = new IndexedDbDriver(`awsm-integration-${crypto.randomUUID()}`, id("0"));
  await driver.getVaultHead();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(driver.databaseName);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const setup = database.transaction(
    ["workspace_metadata", "vault_metadata", "vault_head"],
    "readwrite",
  );
  setup.objectStore("workspace_metadata").put(
    {
      version: 1,
      workspaceId: id("999"),
      createdAt: "2026-07-18T12:59:00.000Z",
      activeVaultId: driver.vaultId,
    },
    "local",
  );
  setup.objectStore("vault_metadata").put(
    {
      version: 1,
      vaultId: driver.vaultId,
      deviceId: id("998"),
      createdAt: "2026-07-18T12:59:00.000Z",
      manuallyLocked: false,
      verifier: { version: 1, nonce: new Uint8Array(24), ciphertext: new Uint8Array(38) },
    },
    vaultSingletonKey(driver.vaultId, "metadata"),
  );
  setup.objectStore("vault_head").put(
    {
      version: 1,
      vaultId: driver.vaultId,
      generationId: id("990"),
      generationNumber: 0,
      appendedObjectIds: [],
      appendedEventIds: [],
    },
    vaultSingletonKey(driver.vaultId, "active"),
  );
  await new Promise<void>((resolve, reject) => {
    setup.addEventListener("complete", () => resolve(), { once: true });
    setup.addEventListener("error", () => reject(setup.error), { once: true });
  });
  const createdAt = "2026-07-18T13:00:00.000Z";
  const job = {
    version: 1 as const,
    vaultId: driver.vaultId,
    jobId: id("960"),
    packageId: id("961"),
    state: "Created" as const,
    stage: "Preflight" as const,
    createdAt,
    updatedAt: createdAt,
    completedEntries: 0,
    totalEntries: 0,
    processedBytes: 0,
    totalBytes: 0,
    cancellationRequested: false,
  };
  const updateContext = async (activeVaultId: string, manuallyLocked: boolean): Promise<void> => {
    const transaction = database.transaction(["workspace_metadata", "vault_metadata"], "readwrite");
    transaction.objectStore("workspace_metadata").put(
      {
        version: 1,
        workspaceId: id("999"),
        createdAt: "2026-07-18T12:59:00.000Z",
        activeVaultId,
      },
      "local",
    );
    transaction.objectStore("vault_metadata").put(
      {
        version: 1,
        vaultId: driver.vaultId,
        deviceId: id("998"),
        createdAt: "2026-07-18T12:59:00.000Z",
        manuallyLocked,
        verifier: { version: 1, nonce: new Uint8Array(24), ciphertext: new Uint8Array(38) },
      },
      vaultSingletonKey(driver.vaultId, "metadata"),
    );
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    });
  };
  let inactiveErrorId = "";
  await updateContext(id("997"), false);
  try {
    await driver.acquireExport(job);
  } catch (error) {
    inactiveErrorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  let lockedErrorId = "";
  await updateContext(driver.vaultId, true);
  try {
    await driver.acquireExport(job);
  } catch (error) {
    lockedErrorId = error instanceof Error && "id" in error ? String(error.id) : "unexpected";
  }
  await updateContext(driver.vaultId, false);
  database.close();
  await driver.acquireExport(job);
  const busy = await driver.managementBusy();
  let registrationBlocked = false;
  let captureBlocked = false;
  let vacuumBlocked = false;
  try {
    await driver.commitRegistration(registration(1));
  } catch {
    registrationBlocked = true;
  }
  try {
    await driver.saveCaptureJob({
      version: 1,
      vaultId: driver.vaultId,
      jobId: id("962"),
      commandId: id("963"),
      tabId: 1,
      state: "Created",
      stage: "Preflight",
      createdAt,
      updatedAt: createdAt,
    });
  } catch {
    captureBlocked = true;
  }
  try {
    await driver.acquireVacuum(id("964"), createdAt);
  } catch {
    vacuumBlocked = true;
  }
  const cancelled = await driver.requestExportCancellation(job.jobId, "2026-07-18T13:00:01.000Z");
  await driver.updateExportJob({
    ...cancelled,
    state: "Cancelled",
    updatedAt: "2026-07-18T13:00:02.000Z",
  });
  await driver.commitRegistration(registration(1));

  const second = {
    ...job,
    jobId: id("965"),
    packageId: id("966"),
    updatedAt: "2026-07-18T13:00:03.000Z",
  };
  await driver.acquireExport(second);
  await driver.updateExportJob({ ...second, state: "Running", stage: "Package" });
  const reconciled = await driver.reconcileInterruptedExports("2026-07-18T13:00:04.000Z");
  const latest = await driver.latestExportJob();
  const result = {
    busy,
    inactiveErrorId,
    lockedErrorId,
    registrationBlocked,
    captureBlocked,
    vacuumBlocked,
    committedAfterCancellation: await driver.hasObject(id("1")),
    reconciled,
    interruptedState: latest?.state,
    interruptedErrorId: latest?.errorId,
  };
  await driver.deleteDatabase();
  return result;
}

async function run(): Promise<void> {
  const scenario = new URL(location.href).searchParams.get("scenario");
  const result =
    scenario === "vault"
      ? await vaultScenario()
      : scenario === "workspace"
        ? await workspaceScenario()
        : scenario === "atomic-vault-create"
          ? await atomicVaultCreateScenario()
          : scenario === "atomic-vault-create-failures"
            ? await atomicVaultCreateFailureScenario()
            : scenario === "atomic-vault-select"
              ? await atomicVaultSelectScenario()
              : scenario === "atomic-vault-select-failures"
                ? await atomicVaultSelectFailureScenario()
                : scenario === "atomic-vault-rename"
                  ? await atomicVaultRenameScenario()
                  : scenario === "atomic-vault-rename-failures"
                    ? await atomicVaultRenameFailureScenario()
                    : scenario === "vault-record-isolation"
                      ? await vaultRecordIsolationScenario()
                      : scenario === "immutable"
                        ? await immutableScenario()
                        : scenario === "vault-isolation"
                          ? await vaultIsolationScenario()
                          : scenario === "capture-job-vault-isolation"
                            ? await captureJobVaultIsolationScenario()
                            : scenario === "event-vault-mismatch"
                              ? await eventVaultMismatchScenario()
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
                                                  : scenario === "management-busy"
                                                    ? await managementBusyScenario()
                                                    : scenario === "export-lease"
                                                      ? await exportLeaseScenario()
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
