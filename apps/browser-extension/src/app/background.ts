import { browser } from "wxt/browser";
import type { RuntimeErrorId } from "../domain/contracts";
import { IndexedDbDriver, IndexedDbVaultRepository } from "../drivers/indexeddb";
import { ChromeCaptureHost, ChromeScreenshotHost } from "../hosts/chrome/api";
import { acquireMandatoryMhtml, preflightCapture } from "../hosts/chrome/capture";
import { acquireBestEffortScreenshot } from "../hosts/chrome/screenshot";
import { CaptureRuntime, defaultPrepareRegistration } from "../runtime/capture/service";
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
import { VaultVacuumService } from "../runtime/library/vacuum";
import { VaultService } from "../runtime/vault";
import { RUNTIME_VERSION } from "../runtime/version";
import { recentCaptureMatchesActiveUrl } from "../ui/popup-view";
import { bytesToBase64 } from "./base64";
import type {
  AppRequestV1,
  AppResponseV1,
  AppStateV1,
  LibraryOperationReceiptV1,
} from "./protocol";

const driver = new IndexedDbDriver();
const vaultRepository = new IndexedDbVaultRepository();
const vault = new VaultService(vaultRepository);
const captureHost = new ChromeCaptureHost();

const startup = driver.reconcileInterruptedVacuum();

function safeError(error: unknown): AppResponseV1 {
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
    CAPTURE_TOO_LARGE: "The page is larger than the 100 MiB capture limit.",
    CAPTURE_INTERRUPTED: "Capture was interrupted. Retry it manually.",
    BUNDLE_INVALID: "The archived capture is missing or corrupt.",
    CRYPTO_AUTHENTICATION_FAILED: "Local Vault encryption could not be initialized.",
    WRONG_PASSPHRASE: "The Vault could not be unlocked.",
    LIBRARY_STATE_CHANGED: "The Library changed. Refresh it and try again.",
  };
  return {
    version: 1,
    ok: false,
    error: { id, message: messages[id] ?? "The operation could not be completed safely." },
  };
}

async function state(): Promise<AppStateV1> {
  const records = await vaultRepository.load();
  let latestJob = await driver.latestCaptureJob();
  let latestWarnings: AppStateV1["latestWarnings"];
  let recentCapture: AppStateV1["recentCapture"];
  if (
    records !== undefined &&
    vault.isUnlocked() &&
    latestJob?.state === "Succeeded" &&
    latestJob.noticeDismissed !== true
  ) {
    const outcome = await driver.findCommandOutcome(latestJob.commandId);
    if (outcome !== undefined) {
      const libraryService = new LibraryService(
        driver,
        vault.requireRootKey(),
        records.metadata.vaultId,
      );
      const detail = await libraryService.detail(outcome.bundleId);
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (recentCaptureMatchesActiveUrl(detail.item.originalUrl, activeTab?.url)) {
        latestWarnings = detail.item.warnings;
        recentCapture = {
          jobId: latestJob.jobId,
          bundleId: detail.item.bundleId,
          title: detail.item.title,
          warnings: detail.item.warnings,
          ...(detail.item.thumbnailWebp === undefined
            ? {}
            : { screenshotBase64: bytesToBase64(detail.item.thumbnailWebp) }),
        };
      } else {
        await driver.dismissCaptureNotice(latestJob.jobId);
        latestJob = { ...latestJob, noticeDismissed: true };
      }
    }
  }
  return {
    version: 1,
    vaultExists: records !== undefined,
    unlocked: vault.isUnlocked(),
    hasPassphraseSlot: records?.passphraseSlot !== undefined,
    ...(latestJob === undefined ? {} : { latestJob }),
    ...(latestWarnings === undefined ? {} : { latestWarnings }),
    ...(recentCapture === undefined ? {} : { recentCapture }),
  };
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "awsm:popup-lifetime:v1") return;
  let visibleJobId: string | undefined;
  port.onMessage.addListener((message: unknown) => {
    if (typeof message !== "object" || message === null || !("jobId" in message)) return;
    const jobId = message.jobId;
    visibleJobId = typeof jobId === "string" ? jobId : undefined;
  });
  port.onDisconnect.addListener(() => {
    if (visibleJobId !== undefined)
      void driver.dismissCaptureNotice(visibleJobId).catch(() => undefined);
  });
});

async function library(): Promise<LibraryService> {
  const records = await vaultRepository.load();
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = new LibraryService(driver, vault.requireRootKey(), records.metadata.vaultId);
  const [projections, events] = await Promise.all([
    driver.listEncryptedProjections(),
    driver.listStoredEvents(),
  ]);
  if (projections.length === 0 && events.length > 0) {
    await new LibraryProjectionRebuilder(
      driver,
      vault.requireRootKey(),
      records.metadata.vaultId,
    ).execute();
  }
  return service;
}

async function libraryGroups(
  status: "Active" | "Deleted" = "Active",
): Promise<import("./protocol").LibraryPageGroupMessageV1[]> {
  const service = await library();
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
  bundleIds: readonly string[],
  operation: "Delete" | "Restore",
): Promise<void> {
  const records = await vaultRepository.load();
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = await library();
  const expected = operation === "Delete" ? "Active" : "Deleted";
  const items = await service.list();
  let selected: readonly import("../domain/contracts").LibraryItemV1[];
  try {
    selected = selectLibraryItems(items, bundleIds, expected);
  } catch {
    throw Object.assign(new Error("Missing capture in expected state"), { id: "BUNDLE_INVALID" });
  }
  const timestamp = new Date().toISOString();
  const prepared = await prepareLibraryStateChange({
    rootKey: vault.requireRootKey(),
    vaultId: records.metadata.vaultId,
    deviceId: records.metadata.deviceId,
    eventId: crypto.randomUUID(),
    timestamp,
    operation,
    items: selected,
  });
  await driver.commitLibraryState(prepared.event, prepared.projections);
}

async function vacuumEstimate(): Promise<{
  readonly version: 1;
  readonly deletedCaptureCount: number;
  readonly reclaimableBytes: number;
}> {
  const service = await library();
  const deleted = await service.listDeleted();
  const objectIds = new Set(deleted.map((item) => item.bundleObjectId));
  const objects = await driver.listStoredObjects();
  return {
    version: 1,
    deletedCaptureCount: deleted.length,
    reclaimableBytes: objects
      .filter((object) => objectIds.has(object.objectId))
      .reduce((total, object) => total + object.envelopeBytes.byteLength, 0),
  };
}

async function captureActivePage(tabId?: number): Promise<{ readonly bundleId: string }> {
  const records = await vaultRepository.load();
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const tab =
    tabId === undefined ? await captureHost.getActiveTab() : await captureHost.getTab(tabId);
  if (tab?.id === undefined || tab.url === undefined) {
    throw Object.assign(new Error("Unsupported page"), { id: "UNSUPPORTED_URL" });
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
    isVaultUnlocked: () => vault.isUnlocked(),
    rootKey: () => vault.requireRootKey(),
    findOutcome: (id) => driver.findCommandOutcome(id),
    saveJob: (job) => driver.saveCaptureJob(job),
    commitRegistration: (input) => driver.commitRegistration(input),
    preflight: () => preflightCapture(selectedHost, vault.isUnlocked()),
    acquireMhtml: (tabId) => acquireMandatoryMhtml(captureHost, tabId),
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
      const service = await library();
      const [items, topology] = await Promise.all([service.list(), service.topology()]);
      return { items, topology };
    },
    prepareRegistration: defaultPrepareRegistration,
    uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const outcome = await runtime.execute(command);
  return { bundleId: outcome.bundleId };
}

type CollectionManagementRequest = Extract<
  AppRequestV1,
  {
    readonly type: "MergeCollections" | "MoveCaptures" | "ExtractCaptures" | "UndoLibraryOperation";
  }
>;

async function manageCollections(
  request: CollectionManagementRequest,
): Promise<LibraryOperationReceiptV1> {
  const records = await vaultRepository.load();
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  const service = await library();
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
    const original = await driver.getStoredEvent(request.operationEventId);
    if (original === undefined) {
      throw Object.assign(new Error("Library operation missing"), {
        id: "LIBRARY_STATE_CHANGED",
      });
    }
    const decoded = await decodeCollectionOperationEvent(
      original,
      vault.requireRootKey(),
      records.metadata.vaultId,
    );
    if (decoded.eventType === "CapturesMoved") {
      const moves = invertCaptureMoves(items, topology, decoded.moves);
      fact = { eventType: "CapturesMoved", moves, revertsEventId: original.eventId };
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
        throw Object.assign(new Error("Merge state changed"), { id: "LIBRARY_STATE_CHANGED" });
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
    rootKey: vault.requireRootKey(),
    vaultId: records.metadata.vaultId,
    deviceId: records.metadata.deviceId,
    eventId,
    timestamp,
    items,
    topology,
    fact,
  });
  await driver.commitCollectionOperation(prepared);
  return { version: 1, operationEventId: eventId, destinationCollectionId };
}

async function handle(request: AppRequestV1): Promise<AppResponseV1> {
  await startup;
  try {
    switch (request.type) {
      case "GetState":
        return { version: 1, ok: true, value: await state() };
      case "CreateVault":
        await vault.create(
          request.passphrase === undefined ? {} : { passphrase: request.passphrase },
        );
        return { version: 1, ok: true, value: await state() };
      case "UnlockDevice":
        await vault.unlockWithDevice();
        return { version: 1, ok: true, value: await state() };
      case "UnlockPassphrase":
        await vault.unlockWithPassphrase(request.passphrase);
        return { version: 1, ok: true, value: await state() };
      case "LockVault":
        await vault.lock();
        return { version: 1, ok: true, value: await state() };
      case "DismissRecentCapture":
        await driver.dismissCaptureNotice(request.jobId);
        return { version: 1, ok: true, value: await state() };
      case "CaptureActivePage":
        return { version: 1, ok: true, value: await captureActivePage(request.tabId) };
      case "ListLibrary":
        return { version: 1, ok: true, value: await libraryGroups() };
      case "ListDeleted":
        return { version: 1, ok: true, value: await libraryGroups("Deleted") };
      case "DeleteCaptures":
        await changeLibraryState(request.bundleIds, "Delete");
        return { version: 1, ok: true, value: null };
      case "RestoreCaptures":
        await changeLibraryState(request.bundleIds, "Restore");
        return { version: 1, ok: true, value: null };
      case "MergeCollections":
      case "MoveCaptures":
      case "ExtractCaptures":
      case "UndoLibraryOperation":
        return { version: 1, ok: true, value: await manageCollections(request) };
      case "VacuumVault": {
        const records = await vaultRepository.load();
        if (records === undefined) {
          throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
        }
        const service = await library();
        const result = await new VaultVacuumService(
          driver,
          service,
          vault.requireRootKey(),
          records.metadata.vaultId,
          records.metadata.deviceId,
        ).execute();
        return { version: 1, ok: true, value: result };
      }
      case "GetVacuumEstimate":
        return { version: 1, ok: true, value: await vacuumEstimate() };
      case "GetLibraryDetail": {
        const detail = await (await library()).detail(request.bundleId);
        return {
          version: 1,
          ok: true,
          value: {
            item: detail.item,
            metadata: detail.metadata,
            mhtmlBase64: bytesToBase64(detail.mhtml),
            ...(detail.screenshot === undefined
              ? {}
              : { screenshotBase64: bytesToBase64(detail.screenshot) }),
          },
        };
      }
    }
  } catch (error) {
    return safeError(error);
  }
}

export function startBackground(): void {
  const ready = Promise.all([
    driver.reconcileInterruptedJobs(new Date().toISOString()),
    vault.autoUnlock().catch(() => false),
  ]);
  browser.runtime.onMessage.addListener((request: unknown) => {
    if (
      typeof request !== "object" ||
      request === null ||
      !("version" in request) ||
      request.version !== RUNTIME_VERSION.api ||
      !("type" in request)
    ) {
      return undefined;
    }
    return ready.then(() => handle(request as AppRequestV1));
  });
}
