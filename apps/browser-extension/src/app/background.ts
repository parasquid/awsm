import { browser } from "wxt/browser";
import type { RuntimeErrorId } from "../domain/contracts";
import { IndexedDbDriver, IndexedDbVaultRepository } from "../drivers/indexeddb";
import { ChromeCaptureHost, ChromeScreenshotHost } from "../hosts/chrome/api";
import { acquireMandatoryMhtml, preflightCapture } from "../hosts/chrome/capture";
import { acquireBestEffortScreenshot } from "../hosts/chrome/screenshot";
import { CaptureRuntime, defaultPrepareRegistration } from "../runtime/capture/service";
import { prepareLibraryStateChange, selectLibraryItems } from "../runtime/library/lifecycle";
import { LibraryService } from "../runtime/library/service";
import { VaultVacuumService } from "../runtime/library/vacuum";
import { VaultService } from "../runtime/vault";
import { RUNTIME_VERSION } from "../runtime/version";
import { bytesToBase64 } from "./base64";
import type { AppRequestV1, AppResponseV1, AppStateV1 } from "./protocol";

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
  };
  return {
    version: 1,
    ok: false,
    error: { id, message: messages[id] ?? "The operation could not be completed safely." },
  };
}

async function state(): Promise<AppStateV1> {
  const records = await vaultRepository.load();
  const latestJob = await driver.latestCaptureJob();
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
      latestWarnings = detail.item.warnings;
      recentCapture = {
        jobId: latestJob.jobId,
        bundleId: detail.item.bundleId,
        title: detail.item.title,
        warnings: detail.item.warnings,
        ...(detail.item.thumbnailPng === undefined
          ? {}
          : { screenshotBase64: bytesToBase64(detail.item.thumbnailPng) }),
      };
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

async function library(): Promise<LibraryService> {
  const records = await vaultRepository.load();
  if (records === undefined) throw Object.assign(new Error("Vault locked"), { id: "VAULT_LOCKED" });
  return new LibraryService(driver, vault.requireRootKey(), records.metadata.vaultId);
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
          ...(capture.thumbnailPng === undefined
            ? {}
            : { thumbnailBase64: bytesToBase64(capture.thumbnailPng) }),
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
    prepareRegistration: defaultPrepareRegistration,
    uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const outcome = await runtime.execute(command);
  return { bundleId: outcome.bundleId };
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
