import type { CaptureMetadataV1 } from "../../domain/bundle";
import type {
  CaptureJob,
  CaptureJobStage,
  CapturePageCommandV1,
  CaptureWarningId,
  LibraryItemV1,
  RuntimeErrorId,
} from "../../domain/contracts";
import { decodeCapturePageCommand } from "../../domain/decode-command";
import type { AtomicRegistrationV1, CommandOutcomeV1 } from "../../drivers/indexeddb";
import type { CapturePreflight } from "../../hosts/chrome/capture";
import type { ScreenshotResult } from "../../hosts/chrome/screenshot";
import { type CollectionTopologyEventV1, selectCollectionForCapture } from "../library/collections";
import { type PrepareCaptureRegistrationInput, prepareCaptureRegistration } from "./registration";

export class CaptureRuntimeError extends Error {
  readonly id: RuntimeErrorId;

  constructor(id: RuntimeErrorId, message: string) {
    super(message);
    this.name = "CaptureRuntimeError";
    this.id = id;
  }
}

export interface CaptureRuntimePorts {
  readonly vaultId: string;
  readonly deviceId: string;
  readonly clientVersion: string;
  isVaultUnlocked(): boolean;
  rootKey(): CryptoKey;
  findOutcome(commandId: string): Promise<CommandOutcomeV1 | undefined>;
  saveJob(job: CaptureJob): Promise<void>;
  commitRegistration(input: AtomicRegistrationV1): Promise<CommandOutcomeV1>;
  preflight(command: CapturePageCommandV1): Promise<CapturePreflight>;
  acquireMhtml(tabId: number): Promise<Uint8Array>;
  acquireScreenshot(tabId: number): Promise<ScreenshotResult>;
  collectMetadata(
    command: CapturePageCommandV1,
    preflight: CapturePreflight,
  ): Promise<CaptureMetadataV1>;
  collectionContext(): Promise<{
    readonly items: readonly LibraryItemV1[];
    readonly topology: readonly CollectionTopologyEventV1[];
  }>;
  prepareRegistration(input: PrepareCaptureRegistrationInput): Promise<AtomicRegistrationV1>;
  uuid(): string;
  now(): string;
}

function errorId(error: unknown, defaultId: RuntimeErrorId): RuntimeErrorId {
  if (error instanceof Error && "id" in error && typeof error.id === "string") {
    return error.id as RuntimeErrorId;
  }
  return defaultId;
}

export class CaptureRuntime {
  readonly ports: CaptureRuntimePorts;

  constructor(ports: CaptureRuntimePorts) {
    this.ports = ports;
  }

  async execute(value: unknown): Promise<CommandOutcomeV1> {
    const command = decodeCapturePageCommand(value);
    const existing = await this.ports.findOutcome(command.commandId);
    if (existing !== undefined) return existing;
    if (!this.ports.isVaultUnlocked()) {
      throw new CaptureRuntimeError("VAULT_LOCKED", "Unlock the Vault before capturing a page.");
    }

    const preflight = await this.ports.preflight(command);
    const createdAt = this.ports.now();
    const jobId = this.ports.uuid();
    let job: CaptureJob = {
      version: 1,
      vaultId: this.ports.vaultId,
      jobId,
      commandId: command.commandId,
      tabId: preflight.tabId,
      state: "Created",
      stage: "Preflight",
      createdAt,
      updatedAt: createdAt,
    };
    await this.ports.saveJob(job);

    const saveRunning = async (stage: CaptureJobStage): Promise<void> => {
      job = { ...job, state: "Running", stage, updatedAt: this.ports.now() };
      await this.ports.saveJob(job);
    };
    const fail = async (id: RuntimeErrorId): Promise<void> => {
      job = { ...job, state: "Failed", updatedAt: this.ports.now(), errorId: id };
      await this.ports.saveJob(job);
    };

    let registration: AtomicRegistrationV1;
    try {
      await saveRunning("MHTML");
      const mhtml = await this.ports.acquireMhtml(preflight.tabId);
      await saveRunning("Screenshot");
      const screenshot = await this.ports.acquireScreenshot(preflight.tabId);
      const metadata = await this.ports.collectMetadata(command, preflight);
      const collectionContext = await this.ports.collectionContext();
      const capturedAt = metadata.capturedAt;
      const warnings: readonly CaptureWarningId[] = screenshot.warnings;
      await saveRunning("Commit");
      registration = await this.ports.prepareRegistration({
        rootKey: this.ports.rootKey(),
        vaultId: this.ports.vaultId,
        deviceId: this.ports.deviceId,
        commandId: command.commandId,
        bundleId: this.ports.uuid(),
        bundleObjectId: this.ports.uuid(),
        eventId: this.ports.uuid(),
        collectionId: selectCollectionForCapture(
          collectionContext.items,
          collectionContext.topology,
          metadata.originalUrl,
          () => this.ports.uuid(),
        ),
        capturedAt,
        metadata,
        mhtml,
        ...(screenshot.webpBytes === undefined ? {} : { screenshot: screenshot.webpBytes }),
        ...(screenshot.thumbnailWebpBytes === undefined
          ? {}
          : { thumbnailWebp: screenshot.thumbnailWebpBytes }),
        warnings,
        clientVersion: this.ports.clientVersion,
      });
    } catch (error) {
      const defaultId = job.stage === "MHTML" ? "MHTML_CAPTURE_FAILED" : "BUNDLE_INVALID";
      const id = errorId(error, defaultId);
      await fail(id);
      throw error instanceof CaptureRuntimeError
        ? error
        : new CaptureRuntimeError(id, "The page could not be archived.");
    }

    let outcome: CommandOutcomeV1;
    try {
      outcome = await this.ports.commitRegistration(registration);
    } catch {
      await fail("STORAGE_TRANSACTION_FAILED");
      throw new CaptureRuntimeError(
        "STORAGE_TRANSACTION_FAILED",
        "The capture could not be stored atomically.",
      );
    }

    job = { ...job, state: "Succeeded", stage: "Commit", updatedAt: this.ports.now() };
    await this.ports.saveJob(job);
    return outcome;
  }
}

export function defaultPrepareRegistration(
  input: PrepareCaptureRegistrationInput,
): Promise<AtomicRegistrationV1> {
  return prepareCaptureRegistration(input);
}
