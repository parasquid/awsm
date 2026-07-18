import { describe, expect, it, vi } from "vitest";
import type { CaptureMetadataV1 } from "../../src/domain/bundle";
import type { CapturePageCommandV1 } from "../../src/domain/contracts";
import type { AtomicRegistrationV1, CommandOutcomeV1 } from "../../src/drivers/indexeddb";
import { CaptureHostError } from "../../src/hosts/chrome/capture";
import {
  CaptureRuntime,
  CaptureRuntimeError,
  type CaptureRuntimePorts,
} from "../../src/runtime/capture/service";

const ids = Array.from(
  { length: 20 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
function fixedId(index: number): string {
  const value = ids[index];
  if (value === undefined) throw new Error("Missing fixed test identifier");
  return value;
}
const timestamp = "2026-07-16T17:00:00.000Z";
const command: CapturePageCommandV1 = {
  commandId: fixedId(0),
  commandType: "CapturePage",
  commandVersion: 1,
  issuingDeviceId: fixedId(1),
  createdAt: timestamp,
  tabId: 7,
  observedUrl: "https://fixture.test/start",
  captureProfileId: "ChromeWebPage-v1",
  idempotencyKey: fixedId(0),
};
const metadata: CaptureMetadataV1 = {
  version: 1,
  originalUrl: command.observedUrl,
  finalUrl: "https://fixture.test/final",
  title: "Fixture",
  capturedAt: timestamp,
  contentType: "text/html",
  viewport: { width: 800, height: 600 },
  document: { width: 800, height: 1200 },
  chromeVersion: "149",
  extensionVersion: "0.1.0",
  captureProfileId: "ChromeWebPage-v1",
  captureProfileVersion: 1,
};

function outcome(): CommandOutcomeV1 {
  return {
    version: 1,
    commandId: command.commandId,
    status: "Succeeded",
    bundleId: fixedId(3),
    bundleObjectId: fixedId(4),
    eventId: fixedId(5),
  };
}

function registration(): AtomicRegistrationV1 {
  const result = outcome();
  return {
    object: {
      version: 1,
      objectId: result.bundleObjectId,
      objectType: "Bundle",
      envelopeBytes: new Uint8Array([1]),
    },
    event: {
      version: 1,
      eventId: result.eventId,
      objectId: result.bundleObjectId,
      orderingTimestamp: timestamp,
      envelopeBytes: new Uint8Array([2]),
    },
    projection: { version: 1, bundleId: result.bundleId, envelopeBytes: new Uint8Array([3]) },
    outcome: result,
  };
}

function ports(overrides: Partial<CaptureRuntimePorts> = {}): CaptureRuntimePorts {
  let idIndex = 2;
  return {
    isVaultUnlocked: () => true,
    rootKey: () => ({}) as CryptoKey,
    vaultId: fixedId(10),
    deviceId: fixedId(1),
    clientVersion: "0.1.0",
    findOutcome: vi.fn(async () => undefined),
    saveJob: vi.fn(async () => undefined),
    commitRegistration: vi.fn(async (value) => value.outcome),
    preflight: vi.fn(async () => ({ tabId: 7, url: command.observedUrl })),
    acquireMhtml: vi.fn(async () => new TextEncoder().encode("MIME-Version: 1.0")),
    acquireScreenshot: vi.fn(async () => ({
      pngBytes: new Uint8Array([137, 80, 78, 71]),
      warnings: [],
    })),
    collectMetadata: vi.fn(async () => metadata),
    prepareRegistration: vi.fn(async () => registration()),
    uuid: () => fixedId(idIndex++),
    now: () => timestamp,
    ...overrides,
  };
}

describe("capture Runtime job", () => {
  it("persists stages, commits once, then marks the job succeeded", async () => {
    const fake = ports();
    await expect(new CaptureRuntime(fake).execute(command)).resolves.toEqual(outcome());
    expect(fake.commitRegistration).toHaveBeenCalledOnce();
    expect(vi.mocked(fake.saveJob).mock.calls.map(([job]) => [job.state, job.stage])).toEqual([
      ["Created", "Preflight"],
      ["Running", "MHTML"],
      ["Running", "Screenshot"],
      ["Running", "Commit"],
      ["Succeeded", "Commit"],
    ]);
  });

  it("returns an existing outcome without acquiring the live page", async () => {
    const existing = outcome();
    const fake = ports({ findOutcome: vi.fn(async () => existing) });
    await expect(new CaptureRuntime(fake).execute(command)).resolves.toEqual(existing);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.saveJob).not.toHaveBeenCalled();
  });

  it("fails before creating a job when preflight rejects", async () => {
    const fake = ports({
      preflight: vi.fn(async () => Promise.reject(new CaptureHostError("UNSUPPORTED_URL", "safe"))),
    });
    await expect(new CaptureRuntime(fake).execute(command)).rejects.toMatchObject({
      id: "UNSUPPORTED_URL",
    });
    expect(fake.saveJob).not.toHaveBeenCalled();
    expect(fake.commitRegistration).not.toHaveBeenCalled();
  });

  it("records mandatory MHTML failure without constructing or committing a Bundle", async () => {
    const fake = ports({
      acquireMhtml: vi.fn(async () =>
        Promise.reject(new CaptureHostError("MHTML_CAPTURE_FAILED", "safe")),
      ),
    });
    await expect(new CaptureRuntime(fake).execute(command)).rejects.toMatchObject({
      id: "MHTML_CAPTURE_FAILED",
    });
    expect(fake.prepareRegistration).not.toHaveBeenCalled();
    expect(fake.commitRegistration).not.toHaveBeenCalled();
    expect(vi.mocked(fake.saveJob).mock.calls.at(-1)?.[0]).toMatchObject({
      state: "Failed",
      errorId: "MHTML_CAPTURE_FAILED",
    });
  });

  it("commits mandatory MHTML when the screenshot returns a warning", async () => {
    const fake = ports({
      acquireScreenshot: vi.fn(async () => ({ warnings: ["SCREENSHOT_CAPTURE_FAILED"] as const })),
    });
    await new CaptureRuntime(fake).execute(command);
    expect(fake.prepareRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ warnings: ["SCREENSHOT_CAPTURE_FAILED"] }),
    );
    expect(vi.mocked(fake.prepareRegistration).mock.calls[0]?.[0]).not.toHaveProperty("screenshot");
    expect(fake.commitRegistration).toHaveBeenCalledOnce();
  });

  it("maps an oversized Bundle to CAPTURE_TOO_LARGE and never opens the commit", async () => {
    const fake = ports({
      prepareRegistration: vi.fn(async () =>
        Promise.reject(new CaptureRuntimeError("CAPTURE_TOO_LARGE", "safe")),
      ),
    });
    await expect(new CaptureRuntime(fake).execute(command)).rejects.toMatchObject({
      id: "CAPTURE_TOO_LARGE",
    });
    expect(fake.commitRegistration).not.toHaveBeenCalled();
  });

  it("leaves a Running Commit job if termination occurs after atomic commit", async () => {
    const saveJob = vi.fn(async (job) => {
      if (job.state === "Succeeded") throw new Error("worker terminated");
    });
    const fake = ports({ saveJob });
    await expect(new CaptureRuntime(fake).execute(command)).rejects.toThrow("worker terminated");
    expect(fake.commitRegistration).toHaveBeenCalledOnce();
    expect(saveJob.mock.calls.at(-2)?.[0]).toMatchObject({ state: "Running", stage: "Commit" });
  });
});
