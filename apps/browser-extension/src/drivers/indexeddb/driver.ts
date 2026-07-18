import type { CaptureJobV1 } from "../../domain/contracts";
import { bytesEqual } from "../../domain/hash";
import { deleteDatabase, openDatabase, requestValue, transactionDone } from "./database";
import {
  decodeCaptureJob,
  decodeCommandOutcome,
  decodeStoredEvent,
  decodeStoredObject,
  decodeStoredProjection,
  decodeStoredVaultGeneration,
} from "./decode";
import { StorageDriverError, storageError } from "./errors";
import {
  type AtomicRegistrationV1,
  type CommandOutcomeV1,
  STORES,
  type StoreCounts,
  type StoredEventV1,
  type StoredObjectV1,
} from "./schema";

function abortTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    return;
  }
}

export class IndexedDbDriver {
  private readonly databasePromise: Promise<IDBDatabase>;
  readonly databaseName: string;

  constructor(databaseName = "awsm-vault") {
    this.databaseName = databaseName;
    this.databasePromise = openDatabase(databaseName);
  }

  async putImmutableObject(record: StoredObjectV1): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.objects, "readwrite");
    const store = transaction.objectStore(STORES.objects);
    const request: IDBRequest<unknown> = store.get(record.objectId);
    try {
      const existingValue = await requestValue(request);
      if (existingValue === undefined) {
        store.add(record, record.objectId);
        await transactionDone(transaction);
        return;
      }
      const existing = decodeStoredObject(existingValue);
      await transactionDone(transaction);
      if (
        existing.objectType !== record.objectType ||
        !bytesEqual(existing.envelopeBytes, record.envelopeBytes)
      ) {
        throw new StorageDriverError(
          "IMMUTABLE_OBJECT_CONFLICT",
          "An Object identifier already exists with different bytes.",
        );
      }
    } catch (error) {
      throw storageError(error);
    }
  }

  async commitRegistration(input: AtomicRegistrationV1): Promise<CommandOutcomeV1> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.objects,
        STORES.events,
        STORES.libraryProjection,
        STORES.commandOutcomes,
        STORES.vacuumJobs,
        STORES.vaultHead,
      ],
      "readwrite",
    );
    const outcomes = transaction.objectStore(STORES.commandOutcomes);
    try {
      if ((await requestValue(transaction.objectStore(STORES.vacuumJobs).count())) !== 0) {
        throw new Error("Vault Vacuum is in progress. Retry the capture.");
      }
      const headStore = transaction.objectStore(STORES.vaultHead);
      const head = (await requestValue(headStore.get("active"))) as
        | import("./schema").StoredVaultHeadV1
        | undefined;
      if (head === undefined) throw new Error("The active Vault Generation is missing.");
      const existingRequest: IDBRequest<unknown> = outcomes.get(input.outcome.commandId);
      const existing = await requestValue(existingRequest);
      if (existing !== undefined) {
        await transactionDone(transaction);
        return decodeCommandOutcome(existing);
      }
      transaction.objectStore(STORES.objects).add(input.object, input.object.objectId);
      transaction.objectStore(STORES.events).add(input.event, input.event.eventId);
      transaction
        .objectStore(STORES.libraryProjection)
        .add(input.projection, input.projection.bundleId);
      outcomes.add(input.outcome, input.outcome.commandId);
      headStore.put(
        {
          ...head,
          appendedObjectIds: [...head.appendedObjectIds, input.object.objectId].toSorted(),
          appendedEventIds: [...head.appendedEventIds, input.event.eventId].toSorted(),
        },
        "active",
      );
      await transactionDone(transaction);
      return input.outcome;
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async hasObject(objectId: string): Promise<boolean> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.objects, "readonly");
    const request = transaction.objectStore(STORES.objects).count(objectId);
    const count = await requestValue(request);
    await transactionDone(transaction);
    return count === 1;
  }

  async clearLibraryProjection(): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.libraryProjection, "readwrite");
    transaction.objectStore(STORES.libraryProjection).clear();
    try {
      await transactionDone(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }

  async commitLibraryState(
    event: StoredEventV1,
    projections: readonly import("./schema").StoredProjectionV1[],
  ): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.events, STORES.libraryProjection, STORES.vacuumJobs, STORES.vaultHead],
      "readwrite",
    );
    try {
      if ((await requestValue(transaction.objectStore(STORES.vacuumJobs).count())) !== 0) {
        throw new Error("Vault Vacuum is in progress. Retry the Library change.");
      }
      const headStore = transaction.objectStore(STORES.vaultHead);
      const head = (await requestValue(headStore.get("active"))) as
        | import("./schema").StoredVaultHeadV1
        | undefined;
      if (head === undefined) throw new Error("The active Vault Generation is missing.");
      transaction.objectStore(STORES.events).add(event, event.eventId);
      const projectionStore = transaction.objectStore(STORES.libraryProjection);
      for (const projection of projections) projectionStore.put(projection, projection.bundleId);
      headStore.put(
        { ...head, appendedEventIds: [...head.appendedEventIds, event.eventId].toSorted() },
        "active",
      );
      await transactionDone(transaction);
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async saveCaptureJob(value: CaptureJobV1): Promise<void> {
    const job = decodeCaptureJob(value);
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.captureJobs, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORES.captureJobs).put(job, job.jobId);
    try {
      await done;
    } catch (error) {
      throw storageError(error);
    }
  }

  async getCaptureJob(jobId: string): Promise<CaptureJobV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.captureJobs, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(STORES.captureJobs).get(jobId));
    await done;
    return value === undefined ? undefined : decodeCaptureJob(value);
  }

  async latestCaptureJob(): Promise<CaptureJobV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.captureJobs, "readonly");
    const done = transactionDone(transaction);
    const values = await requestValue(transaction.objectStore(STORES.captureJobs).getAll());
    await done;
    return values
      .map(decodeCaptureJob)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async dismissCaptureNotice(jobId: string): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.captureJobs, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORES.captureJobs);
    try {
      const value = await requestValue(store.get(jobId));
      if (value === undefined) throw new Error("Capture job does not exist");
      const job = decodeCaptureJob(value);
      if (job.state !== "Succeeded")
        throw new Error("Only completed capture notices can be dismissed");
      store.put({ ...job, noticeDismissed: true }, job.jobId);
      await done;
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async findCommandOutcome(commandId: string): Promise<CommandOutcomeV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.commandOutcomes, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(
      transaction.objectStore(STORES.commandOutcomes).get(commandId),
    );
    await done;
    return value === undefined ? undefined : decodeCommandOutcome(value);
  }

  async listEncryptedProjections(): Promise<readonly import("./schema").StoredProjectionV1[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.libraryProjection, "readonly");
    const done = transactionDone(transaction);
    const values = await requestValue(transaction.objectStore(STORES.libraryProjection).getAll());
    await done;
    return values.map(decodeStoredProjection);
  }

  async getStoredObject(objectId: string): Promise<StoredObjectV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.objects, "readonly");
    const done = transactionDone(transaction);
    const value = await requestValue(transaction.objectStore(STORES.objects).get(objectId));
    await done;
    return value === undefined ? undefined : decodeStoredObject(value);
  }

  async listStoredObjects(): Promise<readonly StoredObjectV1[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.objects, "readonly");
    const done = transactionDone(transaction);
    const values = await requestValue(transaction.objectStore(STORES.objects).getAll());
    await done;
    return values.map(decodeStoredObject);
  }

  async listStoredEvents(): Promise<readonly StoredEventV1[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.events, "readonly");
    const done = transactionDone(transaction);
    const values = await requestValue(transaction.objectStore(STORES.events).getAll());
    await done;
    return values.map(decodeStoredEvent);
  }

  async commitVacuum(input: {
    readonly jobId: string;
    readonly objectIds: readonly string[];
    readonly eventIds: readonly string[];
    readonly eventsToAdd: readonly StoredEventV1[];
    readonly bundleIds: readonly string[];
    readonly expectedGenerationId?: string;
    readonly generation: import("./schema").StoredVaultGenerationV1;
    readonly head: import("./schema").StoredVaultHeadV1;
  }): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.objects,
        STORES.events,
        STORES.libraryProjection,
        STORES.commandOutcomes,
        STORES.vaultGenerations,
        STORES.vaultHead,
        STORES.vacuumJobs,
      ],
      "readwrite",
    );
    try {
      const vacuumJobs = transaction.objectStore(STORES.vacuumJobs);
      const job = (await requestValue(vacuumJobs.get(input.jobId))) as
        | import("./schema").StoredVacuumJobV1
        | undefined;
      if (job === undefined || job.sourceGenerationId !== input.expectedGenerationId) {
        throw new Error("The Vault Vacuum lease is missing or invalid.");
      }
      const headStore = transaction.objectStore(STORES.vaultHead);
      const currentHead = (await requestValue(headStore.get("active"))) as
        | import("./schema").StoredVaultHeadV1
        | undefined;
      if (currentHead?.generationId !== input.expectedGenerationId) {
        throw new Error("The active Vault Generation changed during Vacuum.");
      }
      const objects = transaction.objectStore(STORES.objects);
      for (const objectId of input.objectIds) objects.delete(objectId);
      const events = transaction.objectStore(STORES.events);
      for (const eventId of input.eventIds) events.delete(eventId);
      for (const event of input.eventsToAdd) events.add(event, event.eventId);
      const projections = transaction.objectStore(STORES.libraryProjection);
      for (const bundleId of input.bundleIds) projections.delete(bundleId);
      const outcomes = transaction.objectStore(STORES.commandOutcomes);
      const outcomeValues = await requestValue(outcomes.getAll());
      for (const value of outcomeValues) {
        const outcome = decodeCommandOutcome(value);
        if (input.bundleIds.includes(outcome.bundleId)) outcomes.delete(outcome.commandId);
      }
      const generations = transaction.objectStore(STORES.vaultGenerations);
      generations.clear();
      generations.add(input.generation, input.generation.generationId);
      headStore.put(input.head, "active");
      vacuumJobs.delete(input.jobId);
      await transactionDone(transaction);
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async acquireVacuum(
    jobId: string,
    createdAt: string,
  ): Promise<import("./schema").StoredVaultHeadV1> {
    const database = await this.databasePromise;
    const transaction = database.transaction([STORES.vaultHead, STORES.vacuumJobs], "readwrite");
    try {
      const jobs = transaction.objectStore(STORES.vacuumJobs);
      if ((await requestValue(jobs.count())) !== 0)
        throw new Error("Vault Vacuum is already in progress.");
      const head = (await requestValue(transaction.objectStore(STORES.vaultHead).get("active"))) as
        | import("./schema").StoredVaultHeadV1
        | undefined;
      if (head === undefined) throw new Error("The active Vault Generation is missing.");
      jobs.add(
        { version: 1, jobId, sourceGenerationId: head.generationId, stage: "Preflight", createdAt },
        jobId,
      );
      await transactionDone(transaction);
      return head;
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async releaseVacuum(jobId: string): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vacuumJobs, "readwrite");
    transaction.objectStore(STORES.vacuumJobs).delete(jobId);
    await transactionDone(transaction);
  }

  async updateVacuumStage(
    jobId: string,
    stage: import("./schema").StoredVacuumJobV1["stage"],
  ): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vacuumJobs, "readwrite");
    const store = transaction.objectStore(STORES.vacuumJobs);
    const value = (await requestValue(store.get(jobId))) as
      | import("./schema").StoredVacuumJobV1
      | undefined;
    if (value === undefined) {
      abortTransaction(transaction);
      throw storageError(new Error("Vault Vacuum lease is missing."));
    }
    store.put({ ...value, stage }, jobId);
    await transactionDone(transaction);
  }

  async getVaultGeneration(
    generationId: string,
  ): Promise<import("./schema").StoredVaultGenerationV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultGenerations, "readonly");
    const value = await requestValue(
      transaction.objectStore(STORES.vaultGenerations).get(generationId),
    );
    await transactionDone(transaction);
    return value === undefined ? undefined : decodeStoredVaultGeneration(value);
  }

  async reconcileInterruptedVacuum(): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vacuumJobs, "readwrite");
    transaction.objectStore(STORES.vacuumJobs).clear();
    await transactionDone(transaction);
  }

  async getVaultHead(): Promise<import("./schema").StoredVaultHeadV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.vaultHead, "readonly");
    const done = transactionDone(transaction);
    const value = (await requestValue(transaction.objectStore(STORES.vaultHead).get("active"))) as
      | import("./schema").StoredVaultHeadV1
      | undefined;
    await done;
    return value;
  }

  async reconcileInterruptedJobs(updatedAt: string): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.captureJobs, STORES.commandOutcomes],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const jobsStore = transaction.objectStore(STORES.captureJobs);
    const outcomesStore = transaction.objectStore(STORES.commandOutcomes);
    try {
      const values = await requestValue(jobsStore.getAll());
      for (const value of values) {
        const job = decodeCaptureJob(value);
        if (job.state !== "Running") continue;
        const outcome = await requestValue(outcomesStore.get(job.commandId));
        const reconciled: CaptureJobV1 =
          outcome === undefined
            ? { ...job, state: "Failed", updatedAt, errorId: "CAPTURE_INTERRUPTED" }
            : { ...job, state: "Succeeded", stage: "Commit", updatedAt };
        jobsStore.put(reconciled, reconciled.jobId);
      }
      await done;
    } catch (error) {
      abortTransaction(transaction);
      throw storageError(error);
    }
  }

  async counts(): Promise<StoreCounts> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.objects, STORES.events, STORES.libraryProjection, STORES.commandOutcomes],
      "readonly",
    );
    const [objects, events, projections, outcomes] = await Promise.all([
      requestValue(transaction.objectStore(STORES.objects).count()),
      requestValue(transaction.objectStore(STORES.events).count()),
      requestValue(transaction.objectStore(STORES.libraryProjection).count()),
      requestValue(transaction.objectStore(STORES.commandOutcomes).count()),
    ]);
    await transactionDone(transaction);
    return { objects, events, projections, outcomes };
  }

  async deleteDatabase(): Promise<void> {
    await deleteDatabase(this.databaseName, await this.databasePromise);
  }
}
