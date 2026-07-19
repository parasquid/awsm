import { encodeCanonicalCbor } from "../../domain/cbor";
import { DomainValidationError } from "../../domain/errors";
import { canonicalRecord, literal, uuid } from "../../domain/validation";
import { openDatabase, requestValue, transactionDone } from "./database";
import { storageError } from "./errors";
import {
  type AccountConfigurationV1,
  STORES,
  type StoredAccountMetadataV1,
  type StoredAccountSecretsV1,
  type StoredAccountVaultV1,
  type SynchronizationCheckpointV1,
  type SynchronizationJobV1,
} from "./schema";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function accountAad(accountId: string, sessionId: string): Uint8Array {
  return encodeCanonicalCbor(["account:session-storage:v1", accountId, sessionId]);
}

function accountWrappingKey(value: unknown): CryptoKey {
  if (
    !(value instanceof CryptoKey) ||
    value.extractable ||
    value.algorithm.name !== "AES-KW" ||
    !value.usages.includes("wrapKey") ||
    !value.usages.includes("unwrapKey")
  ) {
    throw new DomainValidationError("accountWrappingKey", "must be a non-exportable AES-KW key");
  }
  return value;
}

function sessionStorageKey(value: unknown): CryptoKey {
  if (
    !(value instanceof CryptoKey) ||
    value.extractable ||
    value.algorithm.name !== "AES-GCM" ||
    !value.usages.includes("encrypt") ||
    !value.usages.includes("decrypt")
  ) {
    throw new DomainValidationError("sessionStorageKey", "must be a non-exportable AES-GCM key");
  }
  return value;
}

function metadata(value: unknown): StoredAccountMetadataV1 {
  const input = canonicalRecord(value, "accountMetadata", [
    "version",
    "accountId",
    "sessionId",
    "email",
    "accountKeyId",
    "accountKeyEnvelope",
  ]);
  if (typeof input.email !== "string" || typeof input.accountKeyEnvelope !== "object") {
    throw new DomainValidationError("accountMetadata", "contains invalid Account metadata");
  }
  return {
    version: literal(input.version, 1, "accountMetadata.version"),
    accountId: uuid(input.accountId, "accountMetadata.accountId"),
    sessionId: uuid(input.sessionId, "accountMetadata.sessionId"),
    email: input.email,
    accountKeyId: uuid(input.accountKeyId, "accountMetadata.accountKeyId"),
    accountKeyEnvelope: input.accountKeyEnvelope,
  };
}

function secrets(value: unknown): StoredAccountSecretsV1 {
  const input = canonicalRecord(value, "accountSecrets", [
    "version",
    "accountId",
    "sessionId",
    "wrappedAccountEncryptionKey",
    "refreshNonce",
    "refreshCiphertext",
  ]);
  const bytes = (candidate: unknown, field: string, length?: number): Uint8Array => {
    if (
      !(candidate instanceof Uint8Array) ||
      (length !== undefined && candidate.byteLength !== length)
    )
      throw new DomainValidationError(field, "contains invalid bytes");
    return candidate;
  };
  return {
    version: literal(input.version, 1, "accountSecrets.version"),
    accountId: uuid(input.accountId, "accountSecrets.accountId"),
    sessionId: uuid(input.sessionId, "accountSecrets.sessionId"),
    wrappedAccountEncryptionKey: bytes(
      input.wrappedAccountEncryptionKey,
      "accountSecrets.wrappedAccountEncryptionKey",
      40,
    ),
    refreshNonce: bytes(input.refreshNonce, "accountSecrets.refreshNonce", 12),
    refreshCiphertext: bytes(input.refreshCiphertext, "accountSecrets.refreshCiphertext"),
  };
}

export class IndexedDbAccountRepository {
  private readonly databasePromise: Promise<IDBDatabase>;

  constructor(readonly databaseName = "awsm-vault") {
    this.databasePromise = openDatabase(databaseName);
  }

  async saveAuthenticated(input: {
    readonly metadata: StoredAccountMetadataV1;
    readonly accountEncryptionKey: Uint8Array;
    readonly refreshToken: string;
  }): Promise<void> {
    if (input.accountEncryptionKey.byteLength !== 32)
      throw new DomainValidationError("accountEncryptionKey", "must contain 32 bytes");
    const wrappingKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, [
      "wrapKey",
      "unwrapKey",
    ]);
    const sessionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const carrier = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(input.accountEncryptionKey),
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign"],
    );
    const wrappedAccountEncryptionKey = new Uint8Array(
      await crypto.subtle.wrapKey("raw", carrier, wrappingKey, "AES-KW"),
    );
    const refreshNonce = crypto.getRandomValues(new Uint8Array(12));
    const refreshCiphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: refreshNonce,
          additionalData: Uint8Array.from(
            accountAad(input.metadata.accountId, input.metadata.sessionId),
          ),
        },
        sessionKey,
        encoder.encode(input.refreshToken),
      ),
    );
    const storedSecrets: StoredAccountSecretsV1 = {
      version: 1,
      accountId: input.metadata.accountId,
      sessionId: input.metadata.sessionId,
      wrappedAccountEncryptionKey,
      refreshNonce,
      refreshCiphertext,
    };
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountMetadata, STORES.accountKeys, STORES.accountSecrets],
      "readwrite",
    );
    try {
      transaction.objectStore(STORES.accountMetadata).put(input.metadata, "active");
      transaction.objectStore(STORES.accountKeys).put(wrappingKey, "account-wrapping");
      transaction.objectStore(STORES.accountKeys).put(sessionKey, "session-storage");
      transaction.objectStore(STORES.accountSecrets).put(storedSecrets, "active");
      await transactionDone(transaction);
    } catch (error) {
      transaction.abort();
      throw storageError(error);
    }
  }

  async loadAuthenticated(): Promise<
    | {
        readonly metadata: StoredAccountMetadataV1;
        readonly accountEncryptionKey: Uint8Array;
        readonly refreshToken: string;
        readonly wrappingKey: CryptoKey;
        readonly sessionKey: CryptoKey;
      }
    | undefined
  > {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountMetadata, STORES.accountKeys, STORES.accountSecrets],
      "readonly",
    );
    try {
      const [metadataValue, wrappingValue, sessionValue, secretsValue] = await Promise.all([
        requestValue(transaction.objectStore(STORES.accountMetadata).get("active")),
        requestValue(transaction.objectStore(STORES.accountKeys).get("account-wrapping")),
        requestValue(transaction.objectStore(STORES.accountKeys).get("session-storage")),
        requestValue(transaction.objectStore(STORES.accountSecrets).get("active")),
      ]);
      await transactionDone(transaction);
      if ([wrappingValue, sessionValue, secretsValue].every((value) => value === undefined))
        return undefined;
      if (
        [metadataValue, wrappingValue, sessionValue, secretsValue].some(
          (value) => value === undefined,
        )
      )
        throw new DomainValidationError("account", "is only partially initialized");
      const decodedMetadata = metadata(metadataValue);
      const decodedSecrets = secrets(secretsValue);
      if (
        decodedMetadata.accountId !== decodedSecrets.accountId ||
        decodedMetadata.sessionId !== decodedSecrets.sessionId
      )
        throw new DomainValidationError("account", "has mismatched session identity");
      const wrappingKey = accountWrappingKey(wrappingValue);
      const sessionKey = sessionStorageKey(sessionValue);
      const carrier = await crypto.subtle.unwrapKey(
        "raw",
        Uint8Array.from(decodedSecrets.wrappedAccountEncryptionKey),
        wrappingKey,
        "AES-KW",
        { name: "HMAC", hash: "SHA-256" },
        true,
        ["sign"],
      );
      const accountEncryptionKey = new Uint8Array(await crypto.subtle.exportKey("raw", carrier));
      const refreshBytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Uint8Array.from(decodedSecrets.refreshNonce),
          additionalData: Uint8Array.from(
            accountAad(decodedMetadata.accountId, decodedMetadata.sessionId),
          ),
        },
        sessionKey,
        Uint8Array.from(decodedSecrets.refreshCiphertext),
      );
      return {
        metadata: decodedMetadata,
        accountEncryptionKey,
        refreshToken: decoder.decode(refreshBytes),
        wrappingKey,
        sessionKey,
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  async loadMetadata(): Promise<StoredAccountMetadataV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.accountMetadata, "readonly");
    const value = await requestValue(transaction.objectStore(STORES.accountMetadata).get("active"));
    await transactionDone(transaction);
    return value === undefined ? undefined : metadata(value);
  }

  async hasAuthenticatedSecrets(): Promise<boolean> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountKeys, STORES.accountSecrets],
      "readonly",
    );
    const [keys, secretsCount] = await Promise.all([
      requestValue(transaction.objectStore(STORES.accountKeys).count()),
      requestValue(transaction.objectStore(STORES.accountSecrets).count()),
    ]);
    await transactionDone(transaction);
    if (keys === 0 && secretsCount === 0) return false;
    if (keys !== 2 || secretsCount !== 1)
      throw new DomainValidationError("account", "has partial credential state");
    return true;
  }

  async loadAccountEncryptionKey(): Promise<Uint8Array> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountMetadata, STORES.accountKeys, STORES.accountSecrets],
      "readonly",
    );
    const [metadataValue, wrappingValue, secretsValue] = await Promise.all([
      requestValue(transaction.objectStore(STORES.accountMetadata).get("active")),
      requestValue(transaction.objectStore(STORES.accountKeys).get("account-wrapping")),
      requestValue(transaction.objectStore(STORES.accountSecrets).get("active")),
    ]);
    await transactionDone(transaction);
    if (metadataValue === undefined || wrappingValue === undefined || secretsValue === undefined)
      throw new DomainValidationError("account", "is not authenticated");
    const decodedMetadata = metadata(metadataValue);
    const decodedSecrets = secrets(secretsValue);
    if (decodedMetadata.accountId !== decodedSecrets.accountId)
      throw new DomainValidationError("account", "has mismatched Account identity");
    const carrier = await crypto.subtle.unwrapKey(
      "raw",
      Uint8Array.from(decodedSecrets.wrappedAccountEncryptionKey),
      accountWrappingKey(wrappingValue),
      "AES-KW",
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign"],
    );
    return new Uint8Array(await crypto.subtle.exportKey("raw", carrier));
  }

  async logout(): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [
        STORES.accountKeys,
        STORES.accountSecrets,
        STORES.synchronizationJobs,
        STORES.synchronizationCheckpoints,
      ],
      "readwrite",
    );
    for (const store of [
      STORES.accountKeys,
      STORES.accountSecrets,
      STORES.synchronizationJobs,
      STORES.synchronizationCheckpoints,
    ])
      transaction.objectStore(store).clear();
    await transactionDone(transaction);
  }

  async beginEnrollment(input: {
    readonly registration: StoredAccountVaultV1;
    readonly job: SynchronizationJobV1;
  }): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountVault, STORES.synchronizationJobs],
      "readwrite",
    );
    transaction.objectStore(STORES.accountVault).put(input.registration, "active");
    transaction.objectStore(STORES.synchronizationJobs).put(input.job, "active");
    await transactionDone(transaction);
  }

  async saveDiscoveredVault(input: {
    readonly registration?: StoredAccountVaultV1;
    readonly job: SynchronizationJobV1;
  }): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountVault, STORES.synchronizationJobs],
      "readwrite",
    );
    if (input.registration === undefined) transaction.objectStore(STORES.accountVault).clear();
    else transaction.objectStore(STORES.accountVault).put(input.registration, "active");
    transaction.objectStore(STORES.synchronizationJobs).put(input.job, "active");
    await transactionDone(transaction);
  }

  async latestSynchronizationJob(): Promise<SynchronizationJobV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.synchronizationJobs, "readonly");
    const value = await requestValue(
      transaction.objectStore(STORES.synchronizationJobs).get("active"),
    );
    await transactionDone(transaction);
    return value as SynchronizationJobV1 | undefined;
  }

  async loadAccountVault(): Promise<StoredAccountVaultV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.accountVault, "readonly");
    const value = await requestValue(transaction.objectStore(STORES.accountVault).get("active"));
    await transactionDone(transaction);
    return value as StoredAccountVaultV1 | undefined;
  }

  async saveSynchronizationJob(job: SynchronizationJobV1): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.synchronizationJobs, "readwrite");
    transaction.objectStore(STORES.synchronizationJobs).put(job, "active");
    await transactionDone(transaction);
  }

  async synchronizationCheckpoint(
    vaultId: string,
    kind: "Object" | "Event",
    entityId: string,
  ): Promise<SynchronizationCheckpointV1 | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.synchronizationCheckpoints, "readonly");
    const value = await requestValue(
      transaction.objectStore(STORES.synchronizationCheckpoints).get([vaultId, kind, entityId]),
    );
    await transactionDone(transaction);
    return value as SynchronizationCheckpointV1 | undefined;
  }

  async saveSynchronizationCheckpoint(checkpoint: SynchronizationCheckpointV1): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.synchronizationCheckpoints, "readwrite");
    transaction
      .objectStore(STORES.synchronizationCheckpoints)
      .put(checkpoint, [checkpoint.vaultId, checkpoint.kind, checkpoint.entityId]);
    await transactionDone(transaction);
  }

  async wakeSynchronization(vaultId: string, now = new Date().toISOString()): Promise<boolean> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountVault, STORES.synchronizationJobs],
      "readwrite",
    );
    const [registrationValue, jobValue] = await Promise.all([
      requestValue(transaction.objectStore(STORES.accountVault).get("active")),
      requestValue(transaction.objectStore(STORES.synchronizationJobs).get("active")),
    ]);
    const registration = registrationValue as StoredAccountVaultV1 | undefined;
    const current = jobValue as SynchronizationJobV1 | undefined;
    if (registration?.vaultId !== vaultId) {
      await transactionDone(transaction);
      return false;
    }
    if (
      current?.vaultId === vaultId &&
      current.state !== "Succeeded" &&
      current.state !== "Waiting"
    ) {
      await transactionDone(transaction);
      return false;
    }
    const job: SynchronizationJobV1 = {
      version: 1,
      jobId: crypto.randomUUID(),
      accountId: registration.accountId,
      vaultId,
      generationId: registration.remoteGenerationId,
      generationNumber: registration.remoteGenerationNumber,
      state: "Created",
      stage: "UploadObjects",
      createdAt: now,
      updatedAt: now,
      snapshotCursor: registration.deliveryCursor,
      completedItems: 0,
      totalItems: 0,
      processedBytes: 0,
      totalBytes: 0,
      retryCount: 0,
      attachIdempotencyKey: crypto.randomUUID(),
    };
    transaction.objectStore(STORES.synchronizationJobs).put(job, "active");
    await transactionDone(transaction);
    return true;
  }

  async wakePull(latestCursor?: number, now = new Date().toISOString()): Promise<boolean> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountVault, STORES.synchronizationJobs],
      "readwrite",
    );
    const [registrationValue, jobValue] = await Promise.all([
      requestValue(transaction.objectStore(STORES.accountVault).get("active")),
      requestValue(transaction.objectStore(STORES.synchronizationJobs).get("active")),
    ]);
    const registration = registrationValue as StoredAccountVaultV1 | undefined;
    const current = jobValue as SynchronizationJobV1 | undefined;
    if (
      registration === undefined ||
      (latestCursor !== undefined && latestCursor <= registration.deliveryCursor) ||
      (current !== undefined && current.state !== "Succeeded")
    ) {
      await transactionDone(transaction);
      return false;
    }
    const job: SynchronizationJobV1 = {
      version: 1,
      jobId: crypto.randomUUID(),
      accountId: registration.accountId,
      vaultId: registration.vaultId,
      generationId: registration.remoteGenerationId,
      generationNumber: registration.remoteGenerationNumber,
      state: "Created",
      stage: "FetchChanges",
      createdAt: now,
      updatedAt: now,
      snapshotCursor: registration.deliveryCursor,
      completedItems: 0,
      totalItems: 0,
      processedBytes: 0,
      totalBytes: 0,
      retryCount: 0,
      attachIdempotencyKey: crypto.randomUUID(),
    };
    transaction.objectStore(STORES.synchronizationJobs).put(job, "active");
    await transactionDone(transaction);
    return true;
  }

  async retrySynchronization(now = new Date().toISOString()): Promise<boolean> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.synchronizationJobs, "readwrite");
    const value = await requestValue(
      transaction.objectStore(STORES.synchronizationJobs).get("active"),
    );
    const job = value as SynchronizationJobV1 | undefined;
    if (
      job === undefined ||
      (job.state !== "Waiting" && job.state !== "Failed") ||
      job.errorId === "ACCOUNT_VAULT_SELECTION_REQUIRED"
    ) {
      await transactionDone(transaction);
      return false;
    }
    const { retryAt: _retryAt, errorId: _errorId, ...retryable } = job;
    const retried: SynchronizationJobV1 = {
      ...retryable,
      state: "Created",
      updatedAt: now,
      retryCount: 0,
    };
    transaction.objectStore(STORES.synchronizationJobs).put(retried, "active");
    await transactionDone(transaction);
    return true;
  }

  async recordActivatedGeneration(input: {
    readonly vaultId: string;
    readonly expectedGenerationId: string;
    readonly generationId: string;
    readonly generationNumber: number;
    readonly deliveryCursor: number;
  }): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [STORES.accountVault, STORES.synchronizationJobs],
      "readwrite",
    );
    const value = await requestValue(transaction.objectStore(STORES.accountVault).get("active"));
    const registration = value as StoredAccountVaultV1 | undefined;
    if (
      registration?.vaultId !== input.vaultId ||
      registration.remoteGenerationId !== input.expectedGenerationId
    ) {
      transaction.abort();
      throw new DomainValidationError("accountVault", "changed during Vacuum activation");
    }
    const updated: StoredAccountVaultV1 = {
      ...registration,
      remoteGenerationId: input.generationId,
      remoteGenerationNumber: input.generationNumber,
      deliveryCursor: input.deliveryCursor,
    };
    transaction.objectStore(STORES.accountVault).put(updated, "active");
    transaction.objectStore(STORES.synchronizationJobs).put(
      {
        version: 1,
        jobId: crypto.randomUUID(),
        accountId: registration.accountId,
        vaultId: registration.vaultId,
        generationId: input.generationId,
        generationNumber: input.generationNumber,
        state: "Succeeded",
        stage: "Checkpoint",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        snapshotCursor: input.deliveryCursor,
        completedItems: 0,
        totalItems: 0,
        processedBytes: 0,
        totalBytes: 0,
        retryCount: 0,
        attachIdempotencyKey: crypto.randomUUID(),
      } satisfies SynchronizationJobV1,
      "active",
    );
    await transactionDone(transaction);
  }

  async saveConfiguration(configuration: AccountConfigurationV1): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.accountConfiguration, "readwrite");
    transaction.objectStore(STORES.accountConfiguration).put(configuration, "active");
    await transactionDone(transaction);
  }

  async loadConfiguration(): Promise<AccountConfigurationV1> {
    const database = await this.databasePromise;
    const transaction = database.transaction(STORES.accountConfiguration, "readonly");
    const value = await requestValue(
      transaction.objectStore(STORES.accountConfiguration).get("active"),
    );
    await transactionDone(transaction);
    if (value === undefined) return { version: 1, mode: "Unconfigured" };
    const input = canonicalRecord(value, "accountConfiguration", [
      "version",
      "mode",
      "serverOrigin",
    ]);
    literal(input.version, 1, "accountConfiguration.version");
    if (input.mode === "Unconfigured" || input.mode === "LocalOnly") {
      if (input.serverOrigin !== undefined)
        throw new DomainValidationError("accountConfiguration", "contains an unexpected origin");
      return { version: 1, mode: input.mode };
    }
    if (input.mode !== "Configured" || typeof input.serverOrigin !== "string")
      throw new DomainValidationError("accountConfiguration", "contains an invalid mode");
    return { version: 1, mode: "Configured", serverOrigin: input.serverOrigin };
  }

  async close(): Promise<void> {
    (await this.databasePromise).close();
  }
}
