import { browser } from "wxt/browser";
import type { RuntimeErrorId } from "../domain/contracts";
import {
  encodeStructuredContentSequence,
  normalizedTextFromBlocks,
} from "../domain/structured-content";
import {
  IndexedDbAccountRepository,
  IndexedDbDriver,
  IndexedDbImportRepository,
  IndexedDbVaultRepository,
  IndexedDbWorkspaceRepository,
} from "../drivers/indexeddb";
import { ChromeAccountServerHost } from "../hosts/chrome/account-server";
import { ChromeCaptureHost, ChromeScreenshotHost } from "../hosts/chrome/api";
import { ChromeArtifactStore } from "../hosts/chrome/artifact-store";
import { acquireMandatoryMhtml, preflightCapture } from "../hosts/chrome/capture";
import { ChromeVaultExportHost } from "../hosts/chrome/export";
import { ChromeVaultImportHost } from "../hosts/chrome/import";
import { acquireBestEffortScreenshot } from "../hosts/chrome/screenshot";
import { CoordinationAccountHttp } from "../runtime/account/http";
import { configureSyncServer } from "../runtime/account/server";
import { AccountAuthenticationService } from "../runtime/account/service";
import { AccountSessionManager } from "../runtime/account/session";
import { CaptureRuntime, defaultPrepareRegistration } from "../runtime/capture/service";
import { VaultExportService } from "../runtime/export";
import { VaultImportService } from "../runtime/import/service";
import { prepareLibraryStateChange, selectLibraryItems } from "../runtime/library/lifecycle";
import {
  decodeCollectionOperationEvent,
  invertCaptureMoves,
  planCaptureMove,
  planCollectionMerge,
  prepareCollectionOperation,
} from "../runtime/library/management";
import { LibraryProjectionRebuilder } from "../runtime/library/rebuild";
import { LibraryService } from "../runtime/library/service";
import {
  objectIdsForBundles,
  storedObjectByteLength,
  type VacuumCandidate,
  type VacuumRepository,
  VaultVacuumService,
} from "../runtime/library/vacuum";
import { RemoteBootstrapRunner } from "../runtime/synchronization/bootstrap";
import { CableHintSubscriber } from "../runtime/synchronization/cable";
import { AccountVaultDiscovery } from "../runtime/synchronization/discovery";
import { RemoteReplicaDownloader } from "../runtime/synchronization/download";
import { EnrollmentService } from "../runtime/synchronization/enrollment";
import { SynchronizationHttp } from "../runtime/synchronization/http";
import { IncrementalPullRunner } from "../runtime/synchronization/pull";
import { StaleReplicaRecoveryService } from "../runtime/synchronization/recovery";
import { LocalRecoveryForkBuilder } from "../runtime/synchronization/recovery-fork";
import { EnrollmentRunner } from "../runtime/synchronization/runner";
import { UploadRunner } from "../runtime/synchronization/upload";
import { SynchronizedVacuumActivator } from "../runtime/synchronization/vacuum";
import { VaultService, WorkspaceContextManager, WorkspaceService } from "../runtime/vault";
import { unwrapDeviceSlot } from "../runtime/vault/slots";
import { recentCaptureMatchesActiveUrl } from "../ui/popup-view";
import { bytesToBase64 } from "./base64";
import {
  type AppRequest,
  type AppResponse,
  type AppState,
  isAppRequest,
  type LibraryOperationReceipt,
} from "./protocol";

const databaseName = "awsm-vault";
const vaultRepository = new IndexedDbVaultRepository();
const workspaceRepository = new IndexedDbWorkspaceRepository();
const accountRepository = new IndexedDbAccountRepository();
const accountServerHost = new ChromeAccountServerHost((configuration) =>
  accountRepository.saveConfiguration(configuration),
);
const workspace = new WorkspaceService(workspaceRepository);
const importRepository = new IndexedDbImportRepository();
const importHost = new ChromeVaultImportHost();
const importControllers = new Map<string, AbortController>();
const enrollment = new EnrollmentService(accountRepository, vaultRepository);
let activeSessionManager: AccountSessionManager | undefined;
let activeSessionOrigin: string | undefined;
let activeCable: CableHintSubscriber | undefined;
let activeCableContext: string | undefined;

async function sessionManager(): Promise<AccountSessionManager> {
  const configuration = await accountRepository.loadConfiguration();
  if (configuration.mode !== "Configured")
    throw Object.assign(new Error("No synchronization server is configured."), {
      id: "SERVER_INCOMPATIBLE",
    });
  if (activeSessionManager === undefined || activeSessionOrigin !== configuration.serverOrigin) {
    activeSessionManager = new AccountSessionManager(
      new CoordinationAccountHttp(configuration.serverOrigin),
      accountRepository,
    );
    activeSessionOrigin = configuration.serverOrigin;
  }
  return activeSessionManager;
}

function remoteVaultHead(value: unknown): {
  readonly generationId: string;
  readonly generationNumber: number;
  readonly headCursor: number;
} {
  if (typeof value !== "object" || value === null || !Array.isArray(Reflect.get(value, "vaults")))
    throw Object.assign(new Error("Remote Vault list is invalid."), {
      id: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
  const vaults = Reflect.get(value, "vaults") as unknown[];
  const remote = vaults[0];
  if (
    vaults.length !== 1 ||
    typeof remote !== "object" ||
    remote === null ||
    typeof Reflect.get(remote, "generationId") !== "string" ||
    typeof Reflect.get(remote, "generationNumber") !== "number" ||
    !Number.isSafeInteger(Reflect.get(remote, "generationNumber")) ||
    typeof Reflect.get(remote, "headCursor") !== "number" ||
    !Number.isSafeInteger(Reflect.get(remote, "headCursor"))
  )
    throw Object.assign(new Error("Remote Vacuum head is invalid."), {
      id: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
  return {
    generationId: Reflect.get(remote, "generationId") as string,
    generationNumber: Reflect.get(remote, "generationNumber") as number,
    headCursor: Reflect.get(remote, "headCursor") as number,
  };
}

async function resumeInterruptedSynchronizedVacuum(configuration: {
  readonly version: 1;
  readonly mode: "Configured";
  readonly serverOrigin: string;
}): Promise<void> {
  const context = contexts.active();
  if (context === undefined) return;
  const vacuum = await context.driver.latestVacuumJob();
  if (vacuum?.candidate === undefined) return;
  const registration = await accountRepository.loadAccountVault();
  if (
    registration?.vaultId !== context.vaultId ||
    registration.remoteGenerationId !== vacuum.candidate.expectedGenerationId
  ) {
    await context.driver.discardSynchronizedVacuum(vacuum.jobId);
    return;
  }
  let activatedHeadCursor = vacuum.activatedHeadCursor;
  if (activatedHeadCursor === undefined) {
    const transport = new SynchronizationHttp(configuration.serverOrigin, await sessionManager());
    const remote = remoteVaultHead((await transport.request("GET", "/api/vaults")).body);
    if (
      remote.generationId !== vacuum.candidate.generation.generationId ||
      remote.generationNumber !== vacuum.candidate.generation.generationNumber
    ) {
      if (remote.generationId === vacuum.candidate.expectedGenerationId) {
        await context.driver.discardSynchronizedVacuum(vacuum.jobId);
        return;
      }
      await context.driver.discardSynchronizedVacuum(vacuum.jobId);
      return;
    }
    activatedHeadCursor = remote.headCursor;
    await context.driver.markSynchronizedVacuumActivated(vacuum.jobId, activatedHeadCursor);
  }
  await context.driver.commitVacuum(vacuum.candidate);
  await accountRepository.recordActivatedGeneration({
    vaultId: context.vaultId,
    expectedGenerationId: registration.remoteGenerationId,
    generationId: vacuum.candidate.generation.generationId,
    generationNumber: vacuum.candidate.generation.generationNumber,
    deliveryCursor: activatedHeadCursor,
  });
  await Promise.all(
    vacuum.candidate.deletedArtifactObjectIds.map((objectId) =>
      artifactStore.remove(context.vaultId, objectId),
    ),
  );
  await notifyAppStateChanged();
}

async function executeSynchronization(): Promise<void> {
  const configuration = await accountRepository.loadConfiguration();
  if (configuration.mode !== "Configured") return;
  if (!(await accountRepository.hasAuthenticatedSecrets())) return;
  try {
    await resumeInterruptedSynchronizedVacuum(configuration);
    await accountRepository.wakePull();
    const pending = await accountRepository.latestSynchronizationJob();
    if (
      pending?.state === "AuthenticationRequired" ||
      pending?.state === "Conflict" ||
      pending?.state === "Failed" ||
      (pending?.state === "Waiting" &&
        pending.retryAt !== undefined &&
        Date.parse(pending.retryAt) > Date.now())
    )
      return;
    const runner = new EnrollmentRunner(
      accountRepository,
      vaultRepository,
      new SynchronizationHttp(configuration.serverOrigin, await sessionManager()),
    );
    await runner.run();
    const job = await accountRepository.latestSynchronizationJob();
    if (
      job?.vaultId !== undefined &&
      (job.stage === "UploadObjects" || job.stage === "CommitEvents")
    ) {
      await new UploadRunner(
        accountRepository,
        new IndexedDbDriver(databaseName, job.vaultId),
        artifactStore,
        new SynchronizationHttp(configuration.serverOrigin, await sessionManager()),
      ).run();
    }
    const afterUpload = await accountRepository.latestSynchronizationJob();
    if (afterUpload?.stage === "DownloadRecords") {
      const activated = await new RemoteBootstrapRunner(
        accountRepository,
        workspaceRepository,
        artifactStore,
        new RemoteReplicaDownloader(
          new SynchronizationHttp(configuration.serverOrigin, await sessionManager()),
          artifactStore,
        ),
      ).run();
      if (activated !== undefined) await contexts.reloadFromAuthority();
    }
    const pullJob = await accountRepository.latestSynchronizationJob();
    const active = contexts.active();
    if (
      pullJob?.stage === "FetchChanges" &&
      active !== undefined &&
      pullJob.vaultId === active.vaultId &&
      active.vault.isUnlocked()
    ) {
      const transport = new SynchronizationHttp(configuration.serverOrigin, await sessionManager());
      await new IncrementalPullRunner(
        accountRepository,
        active.driver,
        workspaceRepository,
        artifactStore,
        transport,
        new RemoteReplicaDownloader(transport, artifactStore),
      ).run(active.vault.requireRootKey());
    }
  } catch (error) {
    const job = await accountRepository.latestSynchronizationJob();
    if (job === undefined) throw error;
    const id =
      error instanceof Error && "id" in error ? String(error.id) : "SYNCHRONIZATION_INTERRUPTED";
    const terminal = id === "SYNCHRONIZATION_INTEGRITY_FAILED" || id === "SYNCHRONIZATION_CONFLICT";
    const authentication =
      id === "SYNCHRONIZATION_AUTHENTICATION_REQUIRED" || id === "AUTHENTICATION_FAILED";
    const retryCount = job.retryCount + 1;
    await accountRepository.saveSynchronizationJob({
      ...job,
      state: terminal
        ? id === "SYNCHRONIZATION_CONFLICT"
          ? "Conflict"
          : "Failed"
        : authentication
          ? "AuthenticationRequired"
          : "Waiting",
      retryCount,
      updatedAt: new Date().toISOString(),
      ...(terminal || authentication
        ? { errorId: id }
        : {
            retryAt: new Date(
              Date.now() + Math.min(5_000 * 2 ** (retryCount - 1), 15 * 60_000),
            ).toISOString(),
            errorId: "SYNCHRONIZATION_INTERRUPTED",
          }),
    });
  }
  const registration = await accountRepository.loadAccountVault();
  if (registration !== undefined) {
    const cableContext = `${configuration.serverOrigin}\n${registration.vaultId}`;
    if (activeCable === undefined || activeCableContext !== cableContext) {
      activeCable?.disconnect();
      const transport = new SynchronizationHttp(configuration.serverOrigin, await sessionManager());
      activeCable = new CableHintSubscriber(
        configuration.serverOrigin,
        transport,
        (latestCursor) => {
          void accountRepository.wakePull(latestCursor).then((woke) => {
            if (woke) void runEnrollment();
          });
        },
      );
      activeCableContext = cableContext;
      await activeCable.connect(registration.vaultId).catch(() => undefined);
    }
  }
  await notifyAppStateChanged();
}

let activeSynchronizationRun: Promise<void> | undefined;

function runEnrollment(): Promise<void> {
  if (activeSynchronizationRun !== undefined) return activeSynchronizationRun;
  const run = executeSynchronization().finally(() => {
    if (activeSynchronizationRun === run) activeSynchronizationRun = undefined;
  });
  activeSynchronizationRun = run;
  return run;
}

async function discoverAccountVault(): Promise<void> {
  const configuration = await accountRepository.loadConfiguration();
  if (configuration.mode !== "Configured") return;
  const discovery = new AccountVaultDiscovery(
    accountRepository,
    {
      hasVaultCollision: (vaultId) => workspaceRepository.hasVaultCollision(vaultId),
      loadLocalReplica: async (vaultId) => {
        const records = await vaultRepository.load(vaultId);
        return records === undefined
          ? undefined
          : {
              rootKey: await unwrapDeviceSlot(records.deviceSlot, records.deviceKey),
              generationId: records.head.generationId,
              generationNumber: records.head.generationNumber,
            };
      },
    },
    new SynchronizationHttp(configuration.serverOrigin, await sessionManager()),
  );
  await discovery.run();
}

async function notifyAppStateChanged(): Promise<void> {
  await browser.runtime.sendMessage({ type: "AppStateChanged" }).catch(() => undefined);
}

async function wakeVaultSynchronization(vaultId: string): Promise<void> {
  if (await accountRepository.wakeSynchronization(vaultId)) void runEnrollment();
}

async function assertVaultMutationAllowed(vaultId: string): Promise<void> {
  const job = await accountRepository.latestSynchronizationJob();
  if (job?.vaultId === vaultId && job.state === "Conflict")
    throw Object.assign(new Error("This stale Replica is read-only until it is resolved."), {
      id: "SYNCHRONIZATION_CONFLICT",
    });
}

const contexts = new WorkspaceContextManager({
  workspaceRepository,
  createVaultPreparer: () => new VaultService(vaultRepository),
  createVaultService: (vaultId) => new VaultService(vaultRepository, vaultId),
  createDriver: (vaultId) => new IndexedDbDriver(databaseName, vaultId),
  notify: notifyAppStateChanged,
});
const captureHost = new ChromeCaptureHost();
const artifactStore = new ChromeArtifactStore();
const exportHost = new ChromeVaultExportHost();
const exportControllers = new Map<string, AbortController>();
const ARTIFACT_MESSAGE_CHUNK_BYTES = 256 * 1024;
interface ArtifactSession {
  readonly vaultId: string;
  readonly bundleId: string;
  readonly role: import("../domain/artifact-graph").ArtifactRole;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  pending?: Uint8Array;
}
const artifactSessions = new Map<string, ArtifactSession>();

async function reconcileInterruptedStaleRecovery(): Promise<boolean> {
  const job = await accountRepository.latestSynchronizationJob();
  if (
    job?.state !== "Running" ||
    (job.stage !== "PrepareRecoveryFork" &&
      job.stage !== "PrepareServerReplacement" &&
      job.stage !== "ActivateRecovery")
  )
    return false;
  if (job.recoveryForkVaultId !== undefined)
    await artifactStore.reconcile(job.recoveryForkVaultId, new Set()).catch(() => undefined);
  const { recoveryForkVaultId: _recoveryForkVaultId, ...withoutFork } = job;
  await accountRepository.saveSynchronizationJob({
    ...withoutFork,
    state: "Conflict",
    stage: "Checkpoint",
    updatedAt: new Date().toISOString(),
  });
  return true;
}

async function cancelArtifactSessions(): Promise<void> {
  const sessions = [...artifactSessions.values()];
  artifactSessions.clear();
  await Promise.all(sessions.map((session) => session.reader.cancel().catch(() => undefined)));
}

function artifactFilename(
  bundleId: string,
  role: import("../domain/artifact-graph").ArtifactRole,
): string {
  const extension =
    role === "PRIMARY"
      ? "mhtml"
      : role === "TEXT_EXTRACTED"
        ? "txt"
        : role === "CONTENT_STRUCTURED"
          ? "cborseq"
          : "webp";
  return `awsm-${bundleId.slice(0, 8)}-${role.toLowerCase().replaceAll("_", "-")}.${extension}`;
}

const startup = contexts.initialize().then(async () => {
  await browser.alarms.create("awsm:synchronization-poll", { periodInMinutes: 1 });
  if (await reconcileInterruptedStaleRecovery()) await notifyAppStateChanged();
  const interruptedImport = await importRepository.latest();
  if (await importRepository.reconcileInterrupted(new Date().toISOString())) {
    if (interruptedImport !== undefined) {
      if (
        interruptedImport.destinationVaultId !== undefined &&
        !(await workspaceRepository.hasVaultDirectoryEntry(interruptedImport.destinationVaultId))
      ) {
        await artifactStore
          .reconcile(interruptedImport.destinationVaultId, new Set())
          .catch(() => undefined);
      }
      await importHost.cleanup(interruptedImport.jobId).catch(() => undefined);
    }
    await notifyAppStateChanged();
  }
  const context = contexts.active();
  if (context === undefined) {
    await runEnrollment();
    return;
  }
  await context.driver.reconcileInterruptedVacuum();
  await context.driver.reconcileInterruptedJobs(new Date().toISOString());
  const authoritativeObjects = await context.driver.listStoredObjects();
  await artifactStore.reconcile(
    context.vaultId,
    new Set(
      authoritativeObjects
        .filter((object) => object.objectType === "Artifact")
        .map((object) => object.objectId),
    ),
  );
  const interruptedExport = await context.driver.latestExportJob();
  if (await context.driver.reconcileInterruptedExports(new Date().toISOString())) {
    if (interruptedExport?.state === "Created" || interruptedExport?.state === "Running") {
      await exportHost.cleanup(interruptedExport.packageId).catch(() => undefined);
    }
    await notifyAppStateChanged();
  }
  await runEnrollment();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "awsm:synchronization-poll") void runEnrollment();
});

function safeError(error: unknown): AppResponse {
  const id =
    error instanceof Error && "id" in error && typeof error.id === "string"
      ? (error.id as RuntimeErrorId)
      : "STORAGE_TRANSACTION_FAILED";
  const messages: Partial<Record<RuntimeErrorId, string>> = {
    VAULT_LOCKED: "Unlock the Vault to continue.",
    UNSUPPORTED_URL: "Only regular HTTP and HTTPS pages can be captured.",
    PERMISSION_DENIED: "Chrome did not grant capture permission.",
    MHTML_UNAVAILABLE: "This Chrome installation cannot capture MHTML.",
    MHTML_CAPTURE_FAILED: "Chrome could not archive this page as MHTML.",
    CAPTURE_INTERRUPTED: "Capture was interrupted. Retry it manually.",
    BUNDLE_INVALID: "The archived capture is missing or corrupt.",
    CRYPTO_AUTHENTICATION_FAILED: "Local Vault encryption could not be initialized.",
    INVALID_VAULT_NAME: "Use a Vault name between 1 and 64 characters without controls.",
    VAULT_NOT_FOUND: "The selected Vault no longer exists.",
    VAULT_CONTEXT_CHANGED: "The active Vault changed. Refresh and try again.",
    VAULT_BUSY: "Wait for the active Vault operation to finish.",
    LIBRARY_STATE_CHANGED: "The Library changed. Refresh it and try again.",
    INVALID_EXPORT_PASSPHRASE: "Use at least 12 characters for the Export passphrase.",
    EXPORT_AUTHENTICATION_FAILED: "The Export could not be authenticated.",
    EXPORT_PACKAGE_INVALID: "The Vault could not be proven safe to export.",
    EXPORT_INTERRUPTED: "Export was interrupted. Retry it manually.",
    EXPORT_DOWNLOAD_FAILED: "The encrypted Vault Package could not be downloaded.",
    IMPORT_AUTHENTICATION_FAILED:
      "The Vault Package could not be authenticated. Check the Export passphrase and try again.",
    IMPORT_PACKAGE_INVALID: "This Vault Package is incomplete, corrupt, or unsupported.",
    SELECTIVE_IMPORT_UNSUPPORTED: "This version can import only Complete Vault Packages.",
    VAULT_ALREADY_EXISTS: "This Vault already exists on this device.",
    IMPORT_INTERRUPTED:
      "Import was interrupted before the Vault was added. Select the package and try again.",
    STORAGE_QUOTA_EXCEEDED: "There is not enough local storage to import this Vault.",
    SYNCHRONIZATION_AUTHENTICATION_REQUIRED: "Sign in again to continue synchronization.",
    SYNCHRONIZATION_INTERRUPTED:
      "The synchronization server is unavailable. Local data remains usable.",
    SYNCHRONIZATION_INTEGRITY_FAILED: "Downloaded synchronization data could not be verified.",
    SYNCHRONIZATION_CONFLICT:
      "This stale Replica is read-only until you preserve it and use the server version.",
  };
  return {
    ok: false,
    error: {
      id,
      message: messages[id] ?? "The operation could not be completed safely.",
    },
  };
}

async function state(): Promise<AppState> {
  const [accountConfiguration, accountMetadata, authenticated, synchronizationJob] =
    await Promise.all([
      accountRepository.loadConfiguration(),
      accountRepository.loadMetadata(),
      accountRepository.hasAuthenticatedSecrets(),
      accountRepository.latestSynchronizationJob(),
    ]);
  const context = contexts.active();
  const records = context === undefined ? undefined : await vaultRepository.load(context.vaultId);
  let latestJob = context === undefined ? undefined : await context.driver.latestCaptureJob();
  let latestWarnings: AppState["latestWarnings"];
  let recentCapture: AppState["recentCapture"];
  const busyOperation = context === undefined ? undefined : await context.driver.managementBusy();
  const latestExportJob =
    context === undefined ? undefined : await context.driver.latestExportJob();
  const latestImportJob = await importRepository.latest();
  if (
    records !== undefined &&
    context?.vault.isUnlocked() &&
    latestJob?.state === "Succeeded" &&
    latestJob.noticeDismissed !== true
  ) {
    const outcome = await context.driver.findCommandOutcome(latestJob.commandId);
    if (outcome !== undefined) {
      const libraryService = new LibraryService(
        context.driver,
        context.vault.requireRootKey(),
        records.metadata.vaultId,
        artifactStore,
      );
      const detail = await libraryService.detail(outcome.bundleId);
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (recentCaptureMatchesActiveUrl(detail.item.originalUrl, activeTab?.url)) {
        latestWarnings = detail.item.warnings;
        recentCapture = {
          vaultId: records.metadata.vaultId,
          jobId: latestJob.jobId,
          bundleId: detail.item.bundleId,
          title: detail.item.title,
          warnings: detail.item.warnings,
          ...(detail.item.thumbnailWebp === undefined
            ? {}
            : { screenshotBase64: bytesToBase64(detail.item.thumbnailWebp) }),
        };
      } else {
        await context.driver.dismissCaptureNotice(latestJob.jobId);
        latestJob = { ...latestJob, noticeDismissed: true };
      }
    }
  }
  return {
    account: {
      configuration:
        accountConfiguration.mode === "Configured"
          ? { mode: "Configured", serverOrigin: accountConfiguration.serverOrigin }
          : { mode: accountConfiguration.mode },
      ...(accountMetadata === undefined ? {} : { email: accountMetadata.email }),
      accountState: authenticated ? "Authenticated" : "SignedOut",
      vaultSyncState:
        accountConfiguration.mode === "Configured"
          ? !authenticated
            ? "AuthenticationRequired"
            : synchronizationJob?.errorId === "ACCOUNT_VAULT_SELECTION_REQUIRED"
              ? "SetupRequired"
              : synchronizationJob?.state === "Conflict"
                ? "Conflict"
                : synchronizationJob?.state === "Failed"
                  ? "Failed"
                  : synchronizationJob?.state === "AuthenticationRequired"
                    ? "AuthenticationRequired"
                    : synchronizationJob?.state === "Waiting"
                      ? "Offline"
                      : synchronizationJob === undefined || synchronizationJob.state === "Succeeded"
                        ? "UpToDate"
                        : synchronizationJob.stage === "DownloadRecords" ||
                            synchronizationJob.stage === "ActivateLocal"
                          ? "Downloading"
                          : synchronizationJob.stage === "EnrollVault"
                            ? "Enrolling"
                            : "Uploading"
          : "LocalOnly",
      ...(synchronizationJob?.errorId === undefined ? {} : { errorId: synchronizationJob.errorId }),
      ...(synchronizationJob?.state === "Conflict" ? { staleResolutionRequired: true } : {}),
    },
    workspace: await workspace.state({
      ...(records !== undefined && context?.vault.isUnlocked()
        ? { unlockedVaultId: records.metadata.vaultId }
        : {}),
      ...(latestImportJob?.state === "Created" || latestImportJob?.state === "Running"
        ? { busy: { operation: "Import" as const } }
        : context === undefined || busyOperation === undefined
          ? {}
          : { busy: { vaultId: context.vaultId, operation: busyOperation } }),
    }),
    ...(latestJob === undefined ? {} : { latestJob }),
    ...(latestWarnings === undefined ? {} : { latestWarnings }),
    ...(recentCapture === undefined ? {} : { recentCapture }),
    ...(latestExportJob === undefined ? {} : { latestExportJob }),
    ...(latestImportJob === undefined ? {} : { latestImportJob }),
  };
}

async function accountService(): Promise<AccountAuthenticationService> {
  const configuration = await accountRepository.loadConfiguration();
  if (configuration.mode !== "Configured") {
    throw Object.assign(new Error("No synchronization server is configured."), {
      id: "SERVER_INCOMPATIBLE",
    });
  }
  return new AccountAuthenticationService(
    new CoordinationAccountHttp(configuration.serverOrigin),
    accountRepository,
  );
}

async function completeAccountVault(input: {
  readonly existingVaultId?: string;
  readonly newVaultName?: string;
}): Promise<void> {
  if (input.newVaultName !== undefined) {
    const current = contexts.active();
    await contexts.create({
      name: input.newVaultName,
      ...(current === undefined ? {} : { expectedActiveVaultId: current.vaultId }),
    });
  } else if (
    input.existingVaultId !== undefined &&
    contexts.active()?.vaultId !== input.existingVaultId
  ) {
    const current = contexts.active();
    if (current === undefined)
      throw Object.assign(new Error("Vault not found"), { id: "VAULT_NOT_FOUND" });
    await contexts.select({
      expectedActiveVaultId: current.vaultId,
      vaultId: input.existingVaultId,
    });
  }
  if (input.existingVaultId !== undefined && !contexts.active()?.vault.isUnlocked())
    await contexts.unlockWithDevice(input.existingVaultId);
  const synchronized = contexts.active();
  if (synchronized === undefined)
    throw Object.assign(new Error("Vault not found"), { id: "VAULT_NOT_FOUND" });
  await enrollment.prepare(synchronized.vaultId);
  await runEnrollment();
}

function validateExportPassphrase(passphrase: string): void {
  const codePoints = Array.from(passphrase).length;
  const bytes = new TextEncoder().encode(passphrase).byteLength;
  if (codePoints < 12 || bytes > 1024) {
    throw Object.assign(new Error("Invalid Export passphrase."), {
      id: "INVALID_EXPORT_PASSPHRASE",
    });
  }
}

function exportFilename(createdAt: string, packageId: string): string {
  const stamp = createdAt.replaceAll("-", "").replaceAll(":", "").replace(".000", "");
  return `awsm-vault-${stamp}-${packageId.slice(0, 8)}.awsm`;
}

async function exportVault(
  expectedVaultId: string,
  passphrase: string,
): Promise<{ jobId: string; filename: string }> {
  validateExportPassphrase(passphrase);
  const context = contexts.snapshot(expectedVaultId);
  const records = await vaultRepository.load(context.vaultId);
  if (records === undefined || !context.vault.isUnlocked()) {
    throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  }
  const createdAt = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const packageId = crypto.randomUUID();
  const filename = exportFilename(createdAt, packageId);
  let job: import("../drivers/indexeddb/schema").ExportJobV1 = {
    version: 1,
    vaultId: context.vaultId,
    jobId,
    packageId,
    state: "Created",
    stage: "Preflight",
    createdAt,
    updatedAt: createdAt,
    completedEntries: 0,
    totalEntries: 0,
    processedBytes: 0,
    totalBytes: 0,
    cancellationRequested: false,
  };
  await context.driver.acquireExport(job);
  await notifyAppStateChanged();
  const controller = new AbortController();
  exportControllers.set(jobId, controller);
  const save = async (
    changes: Partial<import("../drivers/indexeddb/schema").ExportJobV1>,
  ): Promise<void> => {
    job = { ...job, ...changes, updatedAt: new Date().toISOString() };
    await context.driver.updateExportJob(job);
    await notifyAppStateChanged();
  };
  try {
    await save({ state: "Running", stage: "Snapshot" });
    await save({ stage: "Verify" });
    const prepared = await new VaultExportService(
      context.driver,
      context.vault,
      context.vaultId,
      artifactStore,
    ).prepare({
      packageId,
      createdAt,
      passphrase,
      salt: crypto.getRandomValues(new Uint8Array(16)),
      nonce: crypto.getRandomValues(new Uint8Array(24)),
    });
    const totalBytes = prepared.manifest.entries.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    );
    await save({
      stage: "Package",
      totalEntries: prepared.manifest.entries.length + 2,
      totalBytes,
    });
    await exportHost.writeAndValidate(packageId, prepared, passphrase, controller.signal);
    await save({
      stage: "Download",
      completedEntries: prepared.manifest.entries.length + 2,
      processedBytes: totalBytes,
    });
    await exportHost.download(packageId, filename, controller.signal);
    await save({ state: "Succeeded" });
    return { jobId, filename };
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const errorId =
      error instanceof Error && "id" in error && typeof error.id === "string"
        ? (error.id as RuntimeErrorId)
        : "EXPORT_PACKAGE_INVALID";
    if (cancelled) {
      await save({ state: "Cancelled", cancellationRequested: true });
    } else {
      await save({
        state: "Failed",
        cancellationRequested: job.cancellationRequested,
        errorId,
      });
    }
    throw error;
  } finally {
    exportControllers.delete(jobId);
    await exportHost.cleanup(packageId).catch(() => undefined);
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "awsm:popup-lifetime") return;
  let visibleCapture: { readonly vaultId: string; readonly jobId: string } | undefined;
  port.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("vaultId" in message) ||
      !("jobId" in message)
    )
      return;
    visibleCapture =
      typeof message.vaultId === "string" && typeof message.jobId === "string"
        ? { vaultId: message.vaultId, jobId: message.jobId }
        : undefined;
  });
  port.onDisconnect.addListener(() => {
    if (visibleCapture === undefined) return;
    const active = contexts.active();
    if (active?.vaultId === visibleCapture.vaultId) {
      void active.driver.dismissCaptureNotice(visibleCapture.jobId).catch(() => undefined);
      return;
    }
    const scopedDriver = new IndexedDbDriver(databaseName, visibleCapture.vaultId);
    void scopedDriver
      .dismissCaptureNotice(visibleCapture.jobId)
      .catch(() => undefined)
      .finally(() => scopedDriver.close());
  });
});

async function library(expectedVaultId: string): Promise<LibraryService> {
  const context = contexts.snapshot(expectedVaultId);
  const records = await vaultRepository.load(context.vaultId);
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = new LibraryService(
    context.driver,
    context.vault.requireRootKey(),
    records.metadata.vaultId,
    artifactStore,
  );
  const [projections, events] = await Promise.all([
    context.driver.listEncryptedProjections(),
    context.driver.listStoredEvents(),
  ]);
  if (projections.length === 0 && events.length > 0) {
    await new LibraryProjectionRebuilder(
      context.driver,
      context.vault.requireRootKey(),
      records.metadata.vaultId,
      artifactStore,
    ).execute();
  }
  return service;
}

async function libraryGroups(
  expectedVaultId: string,
  status: "Active" | "Deleted" = "Active",
): Promise<import("./protocol").LibraryPageGroupMessage[]> {
  const service = await library(expectedVaultId);
  const groups = status === "Active" ? await service.groups() : await service.deletedGroups();
  return Promise.all(
    groups.map(async (group) => {
      const captureThumbnails = await Promise.all(
        group.captures.map(async (capture) => ({
          bundleId: capture.bundleId,
          ...(capture.thumbnailWebp === undefined
            ? {}
            : { thumbnailBase64: bytesToBase64(capture.thumbnailWebp) }),
        })),
      );
      return {
        ...group,
        captureThumbnails,
      };
    }),
  );
}

async function changeLibraryState(
  expectedVaultId: string,
  bundleIds: readonly string[],
  operation: "Delete" | "Restore",
): Promise<void> {
  await assertVaultMutationAllowed(expectedVaultId);
  const context = contexts.snapshot(expectedVaultId);
  const records = await vaultRepository.load(context.vaultId);
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = await library(expectedVaultId);
  const expected = operation === "Delete" ? "Active" : "Deleted";
  const items = await service.list();
  let selected: readonly import("../domain/contracts").LibraryItemV1[];
  try {
    selected = selectLibraryItems(items, bundleIds, expected);
  } catch {
    throw Object.assign(new Error("Missing capture in expected state"), {
      id: "BUNDLE_INVALID",
    });
  }
  const timestamp = new Date().toISOString();
  const prepared = await prepareLibraryStateChange({
    rootKey: context.vault.requireRootKey(),
    vaultId: records.metadata.vaultId,
    deviceId: records.metadata.deviceId,
    eventId: crypto.randomUUID(),
    timestamp,
    operation,
    items: selected,
  });
  contexts.assertCurrent(context);
  await context.driver.commitLibraryState(prepared.event, prepared.projections);
  await wakeVaultSynchronization(context.vaultId);
}

async function vacuumEstimate(expectedVaultId: string): Promise<{
  readonly deletedCaptureCount: number;
  readonly reclaimableBytes: number;
}> {
  const context = contexts.snapshot(expectedVaultId);
  const service = await library(expectedVaultId);
  const deleted = await service.listDeleted();
  const [objects, events] = await Promise.all([
    context.driver.listStoredObjects(),
    context.driver.listStoredEvents(),
  ]);
  const objectIds = await objectIdsForBundles(
    events,
    new Set(deleted.map((item) => item.bundleId)),
    context.vault.requireRootKey(),
    context.vaultId,
  );
  return {
    deletedCaptureCount: deleted.length,
    reclaimableBytes: objects
      .filter((object) => objectIds.has(object.objectId))
      .reduce((total, object) => total + storedObjectByteLength(object), 0),
  };
}

async function captureActivePage(
  expectedVaultId: string,
  tabId?: number,
): Promise<{ readonly bundleId: string }> {
  await assertVaultMutationAllowed(expectedVaultId);
  const context = contexts.snapshot(expectedVaultId);
  const records = await vaultRepository.load(context.vaultId);
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const tab =
    tabId === undefined ? await captureHost.getActiveTab() : await captureHost.getTab(tabId);
  if (tab?.id === undefined || tab.url === undefined) {
    throw Object.assign(new Error("Unsupported page"), {
      id: "UNSUPPORTED_URL",
    });
  }
  const commandId = crypto.randomUUID();
  const command = {
    commandId,
    commandType: "CapturePage" as const,
    commandVersion: 1 as const,
    issuingDeviceId: records.metadata.deviceId,
    createdAt: new Date().toISOString(),
    tabId: tab.id,
    observedUrl: tab.url,
    captureProfileId: "ChromeWebPage-v1" as const,
    idempotencyKey: commandId,
  };
  const selectedHost = {
    getActiveTab: async () => tab,
    hasCapturePermission: () => captureHost.hasCapturePermission(),
    isMhtmlAvailable: () => captureHost.isMhtmlAvailable(),
    saveAsMhtml: (selectedTabId: number) => captureHost.saveAsMhtml(selectedTabId),
  };
  const runtime = new CaptureRuntime({
    vaultId: records.metadata.vaultId,
    deviceId: records.metadata.deviceId,
    clientVersion: browser.runtime.getManifest().version,
    isVaultUnlocked: () => context.vault.isUnlocked(),
    rootKey: () => context.vault.requireRootKey(),
    findOutcome: (id) => context.driver.findCommandOutcome(id),
    saveJob: async (job) => {
      await context.driver.saveCaptureJob(job);
      await notifyAppStateChanged();
    },
    commitRegistration: async (input) => {
      contexts.assertCurrent(context);
      await assertVaultMutationAllowed(context.vaultId);
      const outcome = await context.driver.commitRegistration(input);
      await wakeVaultSynchronization(context.vaultId);
      return outcome;
    },
    preflight: () => preflightCapture(selectedHost, context.vault.isUnlocked()),
    acquireMhtml: (tabId) => acquireMandatoryMhtml(captureHost, tabId),
    collectContent: async (tabId) => {
      try {
        const blocks = await captureHost.collectStructuredContent(tabId);
        return {
          structured: encodeStructuredContentSequence(blocks),
          normalizedText: normalizedTextFromBlocks(blocks),
          warnings: [],
        };
      } catch {
        return {
          warnings: ["STRUCTURED_CONTENT_EXTRACTION_FAILED", "TEXT_EXTRACTION_FAILED"] as const,
        };
      }
    },
    acquireScreenshot: async (tabId) => {
      try {
        return await acquireBestEffortScreenshot(await ChromeScreenshotHost.create(tabId));
      } catch {
        return { warnings: ["SCREENSHOT_UNAVAILABLE"] };
      }
    },
    collectMetadata: (captureCommand, preflight) =>
      captureHost.collectMetadata(
        preflight.tabId,
        captureCommand,
        new Date().toISOString(),
        browser.runtime.getManifest().version,
      ),
    collectionContext: async () => {
      const service = await library(expectedVaultId);
      const [items, topology] = await Promise.all([service.list(), service.topology()]);
      return { items, topology };
    },
    prepareRegistration: defaultPrepareRegistration,
    prepareArtifact: (objectId, plaintext) =>
      artifactStore.prepare({
        vaultId: records.metadata.vaultId,
        objectId,
        rootKey: context.vault.requireRootKey(),
        plaintext: (async function* () {
          if (plaintext instanceof Blob) {
            const reader = plaintext.stream().getReader();
            try {
              for (;;) {
                const next = await reader.read();
                if (next.done) break;
                yield next.value;
              }
            } finally {
              reader.releaseLock();
            }
          } else {
            const size = 1024 * 1024;
            for (let offset = 0; offset < plaintext.byteLength; offset += size)
              yield plaintext.subarray(offset, Math.min(offset + size, plaintext.byteLength));
          }
        })(),
      }),
    removeArtifact: (objectId) => artifactStore.remove(records.metadata.vaultId, objectId),
    uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const outcome = await runtime.execute(command);
  return { bundleId: outcome.bundleId };
}

type CollectionManagementRequest = Extract<
  AppRequest,
  {
    readonly type: "MergeCollections" | "MoveCaptures" | "ExtractCaptures" | "UndoLibraryOperation";
  }
>;

async function manageCollections(
  request: CollectionManagementRequest,
): Promise<LibraryOperationReceipt> {
  await assertVaultMutationAllowed(request.expectedVaultId);
  const context = contexts.snapshot(request.expectedVaultId);
  const records = await vaultRepository.load(context.vaultId);
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = await library(request.expectedVaultId);
  const [items, topology] = await Promise.all([service.list(), service.topology()]);
  const eventId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  let fact: Parameters<typeof prepareCollectionOperation>[0]["fact"];
  let destinationCollectionId: string;
  if (request.type === "MergeCollections") {
    fact = planCollectionMerge(
      items,
      topology,
      request.destinationCollectionId,
      request.sourceCollectionIds,
      eventId,
    );
    destinationCollectionId = fact.destinationCollectionId;
  } else if (request.type === "MoveCaptures") {
    const moves = planCaptureMove(
      items,
      topology,
      request.bundleIds,
      request.destinationCollectionId,
    );
    fact = { eventType: "CapturesMoved", moves };
    destinationCollectionId = moves[0]?.toCollectionId ?? request.destinationCollectionId;
  } else if (request.type === "ExtractCaptures") {
    destinationCollectionId = crypto.randomUUID();
    const moves = planCaptureMove(items, topology, request.bundleIds, destinationCollectionId, {
      allowNewDestination: true,
    });
    fact = { eventType: "CapturesMoved", moves };
  } else {
    const original = await context.driver.getStoredEvent(request.operationEventId);
    if (original === undefined) {
      throw Object.assign(new Error("Library operation missing"), {
        id: "LIBRARY_STATE_CHANGED",
      });
    }
    const decoded = await decodeCollectionOperationEvent(
      original,
      context.vault.requireRootKey(),
      records.metadata.vaultId,
    );
    if (decoded.eventType === "CapturesMoved") {
      const moves = invertCaptureMoves(items, topology, decoded.moves);
      fact = {
        eventType: "CapturesMoved",
        moves,
        revertsEventId: original.eventId,
      };
      destinationCollectionId = moves[0]?.toCollectionId ?? records.metadata.vaultId;
    } else {
      const activeMerge = topology.some(
        (candidate) =>
          candidate.eventType === "CollectionsMerged" && candidate.eventId === original.eventId,
      );
      const alreadyReverted = topology.some(
        (candidate) =>
          candidate.eventType === "CollectionMergeReverted" &&
          candidate.mergeEventId === original.eventId,
      );
      if (!activeMerge || alreadyReverted) {
        throw Object.assign(new Error("Merge state changed"), {
          id: "LIBRARY_STATE_CHANGED",
        });
      }
      fact = {
        eventId,
        eventType: "CollectionMergeReverted",
        mergeEventId: original.eventId,
      };
      destinationCollectionId = decoded.sourceCollectionIds[0] ?? decoded.destinationCollectionId;
    }
  }
  const prepared = await prepareCollectionOperation({
    rootKey: context.vault.requireRootKey(),
    vaultId: records.metadata.vaultId,
    deviceId: records.metadata.deviceId,
    eventId,
    timestamp,
    items,
    topology,
    fact,
  });
  contexts.assertCurrent(context);
  await context.driver.commitCollectionOperation(prepared);
  await wakeVaultSynchronization(context.vaultId);
  return { operationEventId: eventId, destinationCollectionId };
}

async function handle(request: AppRequest): Promise<AppResponse> {
  await startup;
  try {
    switch (request.type) {
      case "GetState":
        void runEnrollment();
        return { ok: true, value: await state() };
      case "ChooseLocalOnly":
        await accountRepository.saveConfiguration({ version: 1, mode: "LocalOnly" });
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "ConfigureSyncServer":
        await configureSyncServer(request.serverOrigin, accountServerHost);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "ChangeSyncServer": {
        activeCable?.disconnect();
        activeCable = undefined;
        activeCableContext = undefined;
        if (await accountRepository.hasAuthenticatedSecrets())
          await (await sessionManager()).logout();
        activeSessionManager = undefined;
        activeSessionOrigin = undefined;
        await configureSyncServer(request.serverOrigin, accountServerHost);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      }
      case "RetrySynchronization":
        if (await accountRepository.retrySynchronization()) void runEnrollment();
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "ResolveStaleReplica": {
        const context = contexts.snapshot(request.expectedVaultId);
        const records = await vaultRepository.load(context.vaultId);
        if (records === undefined)
          throw Object.assign(new Error("Unlock the stale Vault before resolving it."), {
            id: "VAULT_LOCKED",
          });
        const configuration = await accountRepository.loadConfiguration();
        if (configuration.mode !== "Configured")
          throw Object.assign(new Error("The synchronization server is unavailable."), {
            id: "SERVER_INCOMPATIBLE",
          });
        const workspaceState = await workspace.state({ unlockedVaultId: context.vaultId });
        const sourceName = workspaceState.vaults.find(
          (candidate) => candidate.vaultId === context.vaultId,
        )?.name;
        if (sourceName === undefined)
          throw Object.assign(new Error("The stale Vault is unavailable."), {
            id: "VAULT_CONTEXT_CHANGED",
          });
        const transport = new SynchronizationHttp(
          configuration.serverOrigin,
          await sessionManager(),
        );
        const result = await new StaleReplicaRecoveryService(
          accountRepository,
          workspaceRepository,
          context.driver,
          records,
          context.vault.requireRootKey(),
          new LocalRecoveryForkBuilder(
            await library(context.vaultId),
            sourceName,
            new VaultService(vaultRepository),
            artifactStore,
            browser.runtime.getManifest().version,
          ),
          new RemoteReplicaDownloader(transport, artifactStore),
          artifactStore,
        ).execute();
        await contexts.reloadFromAuthority();
        await notifyAppStateChanged();
        return { ok: true, value: result };
      }
      case "LoginAccount":
        {
          const access = await (await accountService()).login({
            email: request.email,
            password: request.password,
          });
          (await sessionManager()).setAccessToken(access);
        }
        await discoverAccountVault();
        await runEnrollment();
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "SignupAccount": {
        {
          const access = await (await accountService()).signup({
            email: request.email,
            password: request.password,
          });
          (await sessionManager()).setAccessToken(access);
        }
        await completeAccountVault(request);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      }
      case "CompleteAccountVault":
        await completeAccountVault(request);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "LogoutAccount":
        activeCable?.disconnect();
        activeCable = undefined;
        activeCableContext = undefined;
        await (await sessionManager()).logout();
        activeSessionManager = undefined;
        activeSessionOrigin = undefined;
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      case "SuggestVaultName":
        return { ok: true, value: { name: await workspace.suggestName() } };
      case "CreateVault":
        await contexts.create(request);
        return { ok: true, value: await state() };
      case "SelectActiveVault":
        await cancelArtifactSessions();
        await contexts.select(request);
        return { ok: true, value: await state() };
      case "RenameVault":
        await assertVaultMutationAllowed(request.vaultId);
        await contexts.rename(request);
        await wakeVaultSynchronization(request.vaultId);
        return { ok: true, value: await state() };
      case "UnlockDevice": {
        await contexts.unlockWithDevice(request.expectedVaultId);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      }
      case "LockVault": {
        await cancelArtifactSessions();
        const context = contexts.snapshot(request.expectedVaultId);
        await context.vault.lock();
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      }
      case "DismissRecentCapture": {
        const context = contexts.snapshot(request.expectedVaultId);
        await context.driver.dismissCaptureNotice(request.jobId);
        await notifyAppStateChanged();
        return { ok: true, value: await state() };
      }
      case "CaptureActivePage":
        return {
          ok: true,
          value: await captureActivePage(request.expectedVaultId, request.tabId),
        };
      case "ListLibrary":
        return {
          ok: true,
          value: await libraryGroups(request.expectedVaultId),
        };
      case "ListDeleted":
        return {
          ok: true,
          value: await libraryGroups(request.expectedVaultId, "Deleted"),
        };
      case "DeleteCaptures":
        await changeLibraryState(request.expectedVaultId, request.bundleIds, "Delete");
        await notifyAppStateChanged();
        return { ok: true, value: null };
      case "RestoreCaptures":
        await changeLibraryState(request.expectedVaultId, request.bundleIds, "Restore");
        await notifyAppStateChanged();
        return { ok: true, value: null };
      case "MergeCollections":
      case "MoveCaptures":
      case "ExtractCaptures":
      case "UndoLibraryOperation": {
        const receipt = await manageCollections(request);
        await notifyAppStateChanged();
        return { ok: true, value: receipt };
      }
      case "VacuumVault": {
        await assertVaultMutationAllowed(request.expectedVaultId);
        const context = contexts.snapshot(request.expectedVaultId);
        const records = await vaultRepository.load(context.vaultId);
        if (records === undefined) {
          throw Object.assign(new Error("Vault locked"), {
            id: "VAULT_LOCKED",
          });
        }
        const service = await library(request.expectedVaultId);
        const accountVault = await accountRepository.loadAccountVault();
        const synchronized = accountVault?.vaultId === context.vaultId;
        if (synchronized) {
          if (!(await accountRepository.hasAuthenticatedSecrets()))
            throw Object.assign(new Error("Synchronized Vacuum requires authentication"), {
              id: "SYNCHRONIZATION_AUTHENTICATION_REQUIRED",
            });
          await runEnrollment();
          const [reconciledJob, reconciledAccount] = await Promise.all([
            accountRepository.latestSynchronizationJob(),
            accountRepository.loadAccountVault(),
          ]);
          if (
            reconciledJob?.state !== "Succeeded" ||
            reconciledAccount?.vaultId !== context.vaultId ||
            reconciledAccount.remoteGenerationId !== records.head.generationId ||
            reconciledAccount.remoteGenerationNumber !== records.head.generationNumber
          )
            throw Object.assign(
              new Error("Synchronized Vacuum requires an online current Replica"),
              {
                id: "SYNCHRONIZATION_INTERRUPTED",
              },
            );
        }
        const repository: VacuumRepository = {
          listStoredObjects: () => context.driver.listStoredObjects(),
          listStoredEvents: () => context.driver.listStoredEvents(),
          getVaultNameProjection: () => context.driver.getVaultNameProjection(),
          acquireVacuum: async (jobId, createdAt) => {
            const head = await context.driver.acquireVacuum(jobId, createdAt);
            await notifyAppStateChanged();
            return head;
          },
          updateVacuumStage: async (jobId, stage) => {
            await context.driver.updateVacuumStage(jobId, stage);
            await notifyAppStateChanged();
          },
          getVaultGeneration: (generationId) => context.driver.getVaultGeneration(generationId),
          releaseVacuum: async (jobId) => {
            await context.driver.releaseVacuum(jobId);
            await notifyAppStateChanged();
          },
          commitVacuum: async (input) => {
            await context.driver.commitVacuum(input);
            await notifyAppStateChanged();
          },
        };
        const activateCandidate = synchronized
          ? async (candidate: VacuumCandidate): Promise<void> => {
              const current = await accountRepository.loadAccountVault();
              if (current === undefined || current.vaultId !== context.vaultId)
                throw Object.assign(new Error("Account Vault context changed"), {
                  id: "VAULT_CONTEXT_CHANGED",
                });
              const configuration = await accountRepository.loadConfiguration();
              if (configuration.mode !== "Configured")
                throw Object.assign(new Error("Synchronization server changed"), {
                  id: "VAULT_CONTEXT_CHANGED",
                });
              const transport = new SynchronizationHttp(
                configuration.serverOrigin,
                await sessionManager(),
              );
              await new SynchronizedVacuumActivator(
                context.vaultId,
                current.remoteGenerationNumber,
                current.deliveryCursor,
                context.driver,
                transport,
                async (approved, activatedHeadCursor) => {
                  await context.driver.commitVacuum(approved);
                  await accountRepository.recordActivatedGeneration({
                    vaultId: context.vaultId,
                    expectedGenerationId: current.remoteGenerationId,
                    generationId: approved.generation.generationId,
                    generationNumber: approved.generation.generationNumber,
                    deliveryCursor: activatedHeadCursor,
                  });
                  await Promise.all(
                    approved.deletedArtifactObjectIds.map((objectId) =>
                      artifactStore.remove(context.vaultId, objectId),
                    ),
                  );
                  await notifyAppStateChanged();
                },
                {
                  persistCandidate: (approved) =>
                    context.driver.persistSynchronizedVacuumCandidate(approved.jobId, approved),
                  markRemoteActivated: (jobId, headCursor) =>
                    context.driver.markSynchronizedVacuumActivated(jobId, headCursor),
                },
              ).activate(candidate);
            }
          : undefined;
        const result = await new VaultVacuumService(
          repository,
          service,
          context.vault.requireRootKey(),
          records.metadata.vaultId,
          records.metadata.deviceId,
          artifactStore,
          activateCandidate,
        ).execute();
        return { ok: true, value: result };
      }
      case "GetVacuumEstimate":
        return {
          ok: true,
          value: await vacuumEstimate(request.expectedVaultId),
        };
      case "ExportVault":
        return {
          ok: true,
          value: await exportVault(request.expectedVaultId, request.passphrase),
        };
      case "CancelVaultExport": {
        const context = contexts.snapshot(request.expectedVaultId);
        await context.driver.requestExportCancellation(request.jobId, new Date().toISOString());
        exportControllers.get(request.jobId)?.abort();
        await notifyAppStateChanged();
        return { ok: true, value: null };
      }
      case "BeginVaultImport": {
        const job = await importRepository.begin({
          jobId: crypto.randomUUID(),
          sourceByteLength: request.sourceByteLength,
          createdAt: new Date().toISOString(),
        });
        await notifyAppStateChanged();
        return { ok: true, value: { jobId: job.jobId } };
      }
      case "ReportVaultImportProgress":
        await importRepository.reportAcquired(
          request.jobId,
          request.acquiredBytes,
          new Date().toISOString(),
        );
        await notifyAppStateChanged();
        return { ok: true, value: null };
      case "CompleteVaultImportStaging": {
        const source = await importHost.open(request.jobId);
        await importRepository.completeStaging(
          request.jobId,
          source.size,
          new Date().toISOString(),
        );
        await notifyAppStateChanged();
        return { ok: true, value: null };
      }
      case "ImportVault": {
        if (importControllers.has(request.jobId)) {
          throw Object.assign(new Error("Vault Import is already running."), {
            id: "VAULT_BUSY",
          });
        }
        const controller = new AbortController();
        importControllers.set(request.jobId, controller);
        let passphrase = request.passphrase;
        Reflect.deleteProperty(request, "passphrase");
        try {
          const source = await importHost.open(request.jobId);
          const value = await new VaultImportService(
            importRepository,
            workspaceRepository,
            artifactStore,
            notifyAppStateChanged,
          ).execute({
            jobId: request.jobId,
            source,
            passphrase,
            signal: controller.signal,
          });
          if (contexts.active() === undefined) await contexts.initialize();
          await notifyAppStateChanged();
          return { ok: true, value };
        } finally {
          passphrase = "";
          importControllers.delete(request.jobId);
          const job = await importRepository.latest().catch(() => undefined);
          if (job?.state !== "Created") {
            await importHost.cleanup(request.jobId).catch(() => undefined);
          }
        }
      }
      case "CancelVaultImport": {
        await importRepository.cancel(request.jobId, new Date().toISOString());
        importControllers.get(request.jobId)?.abort();
        await importHost.cleanup(request.jobId).catch(() => undefined);
        await notifyAppStateChanged();
        return { ok: true, value: null };
      }
      case "GetLibraryDetail": {
        const detail = await (await library(request.expectedVaultId)).detail(request.bundleId);
        return {
          ok: true,
          value: {
            item: detail.item,
            metadata: detail.metadata,
            artifacts: detail.artifacts,
          },
        };
      }
      case "OpenArtifact": {
        const service = await library(request.expectedVaultId);
        const opened = await service.openArtifact(request.bundleId, request.role);
        const sessionId = crypto.randomUUID();
        artifactSessions.set(sessionId, {
          vaultId: request.expectedVaultId,
          bundleId: request.bundleId,
          role: request.role,
          reader: opened.stream.getReader(),
        });
        return {
          ok: true,
          value: {
            sessionId,
            role: request.role,
            mimeType: opened.reference.mimeType,
            byteLength: opened.reference.plaintextByteLength,
            filename: artifactFilename(request.bundleId, request.role),
          },
        };
      }
      case "ReadArtifactChunk": {
        contexts.snapshot(request.expectedVaultId);
        const session = artifactSessions.get(request.sessionId);
        if (session === undefined || session.vaultId !== request.expectedVaultId)
          throw Object.assign(new Error("Artifact session missing"), {
            id: "VAULT_CONTEXT_CHANGED",
          });
        let chunk = session.pending;
        if (chunk === undefined) {
          const next = await session.reader.read();
          if (next.done) {
            artifactSessions.delete(request.sessionId);
            session.reader.releaseLock();
            return { ok: true, value: { done: true } };
          }
          chunk = next.value;
        }
        const outgoing = chunk.subarray(0, ARTIFACT_MESSAGE_CHUNK_BYTES);
        if (outgoing.byteLength === chunk.byteLength) delete session.pending;
        else session.pending = chunk.subarray(outgoing.byteLength);
        return {
          ok: true,
          value: { done: false, chunkBase64: bytesToBase64(outgoing) },
        };
      }
      case "CancelArtifactSession": {
        const session = artifactSessions.get(request.sessionId);
        artifactSessions.delete(request.sessionId);
        if (session !== undefined) await session.reader.cancel().catch(() => undefined);
        return { ok: true, value: null };
      }
    }
  } catch (error) {
    return safeError(error);
  }
}

export function startBackground(): void {
  browser.runtime.onMessage.addListener((request: unknown) => {
    if (!isAppRequest(request)) return undefined;
    return startup.then(() => handle(request));
  });
}
