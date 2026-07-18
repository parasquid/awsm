import type { ArtifactKind, ArtifactRole, CaptureMetadataV1 } from "../../domain/artifact-graph";
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
import type { PreparedArtifact } from "../artifact";
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
  acquireMhtml(tabId: number): Promise<Blob>;
  collectContent(tabId: number): Promise<{
    readonly structured?: Uint8Array;
    readonly normalizedText?: Uint8Array;
    readonly warnings: readonly CaptureWarningId[];
  }>;
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
  prepareArtifact(objectId: string, plaintext: Blob | Uint8Array): Promise<PreparedArtifact>;
  removeArtifact(objectId: string): Promise<void>;
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
    const preparedObjectIds: string[] = [];
    try {
      await saveRunning("MHTML");
      const mhtml = await this.ports.acquireMhtml(preflight.tabId);
      const prepare = async (
        role: ArtifactRole,
        kind: ArtifactKind,
        mimeType: string,
        bytes: Blob | Uint8Array,
        acquiredAt: string,
      ) => {
        const objectId = this.ports.uuid();
        const prepared = await this.ports.prepareArtifact(objectId, bytes);
        preparedObjectIds.push(objectId);
        return {
          object: prepared.object,
          reference: {
            artifactVersion: 1 as const,
            artifactObjectId: objectId,
            kind,
            role,
            mimeType,
            acquiredAt,
            plaintextByteLength: prepared.plaintextByteLength,
            checksumAlgorithm: "hash:sha256:v1" as const,
            plaintextChecksum: prepared.plaintextChecksum,
          },
        };
      };
      const metadata = await this.ports.collectMetadata(command, preflight);
      const artifacts = [
        await prepare("PRIMARY", "CAPTURE", "multipart/related", mhtml, metadata.capturedAt),
      ];
      const warningSet = new Set<CaptureWarningId>();
      await saveRunning("Content");
      const content = await this.ports.collectContent(preflight.tabId);
      for (const warning of content.warnings) warningSet.add(warning);
      if (content.structured !== undefined) {
        try {
          artifacts.push(
            await prepare(
              "CONTENT_STRUCTURED",
              "STRUCTURED_CONTENT",
              "application/cbor-seq",
              content.structured,
              metadata.capturedAt,
            ),
          );
        } catch {
          warningSet.add("STRUCTURED_CONTENT_EXTRACTION_FAILED");
        }
      }
      if (content.normalizedText !== undefined) {
        try {
          artifacts.push(
            await prepare(
              "TEXT_EXTRACTED",
              "TEXT",
              "text/plain;charset=utf-8",
              content.normalizedText,
              metadata.capturedAt,
            ),
          );
        } catch {
          warningSet.add("TEXT_EXTRACTION_FAILED");
        }
      }
      await saveRunning("Screenshot");
      const screenshot = await this.ports.acquireScreenshot(preflight.tabId);
      for (const warning of screenshot.warnings) warningSet.add(warning);
      let fullScreenshotPrepared = false;
      if (screenshot.webpBlob !== undefined) {
        try {
          artifacts.push(
            await prepare(
              "SCREENSHOT_FULL",
              "IMAGE",
              "image/webp",
              screenshot.webpBlob,
              metadata.capturedAt,
            ),
          );
          fullScreenshotPrepared = true;
        } catch {
          warningSet.add("SCREENSHOT_CAPTURE_FAILED");
        }
      }
      if (fullScreenshotPrepared && screenshot.thumbnailWebpBlob !== undefined) {
        try {
          artifacts.push(
            await prepare(
              "THUMBNAIL",
              "IMAGE",
              "image/webp",
              screenshot.thumbnailWebpBlob,
              metadata.capturedAt,
            ),
          );
        } catch {
          warningSet.add("THUMBNAIL_CAPTURE_FAILED");
        }
      }
      const collectionContext = await this.ports.collectionContext();
      const capturedAt = metadata.capturedAt;
      const warnings: readonly CaptureWarningId[] = [...warningSet].toSorted();
      await saveRunning("Commit");
      registration = await this.ports.prepareRegistration({
        rootKey: this.ports.rootKey(),
        vaultId: this.ports.vaultId,
        deviceId: this.ports.deviceId,
        commandId: command.commandId,
        bundleId: this.ports.uuid(),
        descriptorObjectId: this.ports.uuid(),
        eventId: this.ports.uuid(),
        collectionId: selectCollectionForCapture(
          collectionContext.items,
          collectionContext.topology,
          metadata.originalUrl,
          () => this.ports.uuid(),
        ),
        capturedAt,
        metadata,
        artifacts,
        ...(screenshot.thumbnailWebpBlob === undefined
          ? {}
          : { thumbnailWebp: new Uint8Array(await screenshot.thumbnailWebpBlob.arrayBuffer()) }),
        warnings,
        clientVersion: this.ports.clientVersion,
      });
    } catch (error) {
      await Promise.all(preparedObjectIds.map((objectId) => this.ports.removeArtifact(objectId)));
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
      await Promise.all(preparedObjectIds.map((objectId) => this.ports.removeArtifact(objectId)));
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
