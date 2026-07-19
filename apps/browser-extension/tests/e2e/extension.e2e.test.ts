import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import { BlobWriter } from "@zip.js/zip.js";
import { writeArtifactEnvelope } from "../../src/crypto/artifact-envelope";
import { deriveContextKeyFromCryptoKey } from "../../src/crypto/hkdf";
import type { ArtifactReferenceV1, CaptureMetadataV1 } from "../../src/domain/artifact-graph";
import {
  encodeStructuredContentSequence,
  normalizedTextFromBlocks,
} from "../../src/domain/structured-content";
import type {
  StoredArtifactObjectV1,
  StoredEvent,
  StoredObjectV1,
} from "../../src/drivers/indexeddb";
import type { ArtifactStore } from "../../src/runtime/artifact";
import {
  type PreparedCaptureArtifact,
  prepareCaptureRegistration,
} from "../../src/runtime/capture/registration";
import {
  VaultExportService,
  type VaultExportSource,
  writeVaultPackage,
} from "../../src/runtime/export";
import {
  prepareVaultNameChange,
  type VaultRecordsV1,
  type VaultRepository,
  VaultService,
} from "../../src/runtime/vault";

async function preparePortableArtifact(
  encrypted: Map<string, Uint8Array>,
  rootKey: CryptoKey,
  vaultId: string,
  plaintext: Uint8Array,
  role: ArtifactReferenceV1["role"],
  kind: ArtifactReferenceV1["kind"],
  mimeType: string,
  acquiredAt: string,
): Promise<PreparedCaptureArtifact> {
  const objectId = crypto.randomUUID();
  const key = await deriveContextKeyFromCryptoKey(rootKey, {
    vaultId,
    domain: "vault:artifact:v1",
    contextId: objectId,
    keyVersion: 1,
  });
  const chunks: Uint8Array[] = [];
  const summary = await writeArtifactEnvelope({
    objectId,
    key,
    noncePrefix: crypto.getRandomValues(new Uint8Array(16)),
    plaintext: (async function* () {
      yield plaintext;
    })(),
    write: (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    },
  });
  const wrapper = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    wrapper.set(chunk, offset);
    offset += chunk.byteLength;
  }
  encrypted.set(objectId, wrapper);
  const object: StoredArtifactObjectV1 = {
    version: 1,
    objectId,
    objectType: "Artifact",
    envelopeFormat: "artifact:xchacha20poly1305-chunked:v1",
    envelopeByteLength: summary.envelopeByteLength,
    envelopeChecksumAlgorithm: "hash:sha256:v1",
    envelopeChecksum: summary.envelopeChecksum,
  };
  return {
    object,
    reference: {
      artifactVersion: 1,
      artifactObjectId: objectId,
      kind,
      role,
      mimeType,
      acquiredAt,
      plaintextByteLength: summary.plaintextByteLength,
      checksumAlgorithm: "hash:sha256:v1",
      plaintextChecksum: summary.plaintextChecksum,
    },
  };
}

async function extensionPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

async function setLatestImportJobForVisual(
  page: Page,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (next) => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("awsm-vault");
      request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    const transaction = database.transaction("import_jobs", "readwrite");
    const store = transaction.objectStore("import_jobs");
    const jobs = await new Promise<Record<string, unknown>[]>((resolveJobs, reject) => {
      const request = store.getAll();
      request.addEventListener("success", () => resolveJobs(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    const current = jobs[0];
    if (current === undefined || typeof current.jobId !== "string") {
      throw new Error("Import Job is unavailable for rendered-state inspection.");
    }
    const updated: Record<string, unknown> = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString(),
    };
    if (next.errorId === null) delete updated.errorId;
    store.put(updated, current.jobId);
    await new Promise<void>((resolveTransaction, reject) => {
      transaction.addEventListener("complete", () => resolveTransaction(), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    });
    database.close();
  }, patch);
}

test("captures MHTML and a full-page screenshot, then opens and downloads them offline", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(browserName).toBe("chromium");
  const extensionPath = testInfo.outputPath("extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  // Headless Chrome cannot issue the toolbar user gesture that grants activeTab.
  // This permission exists only in the disposable E2E copy, never in the shipping manifest.
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(testInfo.outputPath("chrome-profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const consoleErrors: string[] = [];
  const watchPage = (page: Page): void => {
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
  };
  context.on("page", watchPage);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    worker.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const extensionId = new URL(worker.url()).host;
    await Promise.all(context.pages().map((page) => page.close()));
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4174/fixture");
    await expect(fixturePage.locator("body")).toHaveAttribute(
      "data-live-fixture",
      "executed-only-on-live-page",
    );
    await worker.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: { action: { openPopup(): Promise<void> } };
        }
      ).chrome;
      await extensionApi.action.openPopup();
    });
    const popup = await extensionPopup(context, extensionId);
    await popup.locator("body").press("Tab");
    await expect(popup.getByRole("textbox", { name: "Vault name" })).toBeFocused();
    await popup.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Generate another name" })).toBeFocused();
    await popup.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Create Vault" })).toBeFocused();
    await expect(popup.getByRole("link", { name: "Import existing Vault" })).toBeVisible();
    await popup.keyboard.press("Enter");
    await expect(popup.getByRole("button", { name: "Archive this page" })).toBeVisible();
    await popup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(value: unknown): Promise<readonly { id?: number; url?: string }[]>;
              update(id: number, value: unknown): Promise<unknown>;
            };
            runtime: {
              sendMessage(value: unknown, callback: (response: unknown) => void): void;
            };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      const state = await new Promise<{
        workspace: { activeVaultId?: string };
      }>((resolve) =>
        extensionApi.runtime.sendMessage({ type: "GetState" }, (response) => {
          const result = response as {
            value: { workspace: { activeVaultId?: string } };
          };
          resolve(result.value);
        }),
      );
      if (state.workspace.activeVaultId === undefined) throw new Error("No active Vault.");
      extensionApi.runtime.sendMessage(
        {
          type: "CaptureActivePage",
          expectedVaultId: state.workspace.activeVaultId,
          tabId: fixtureTab.id,
        },
        () => undefined,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
    const completedPopup = popup;
    await expect(completedPopup.getByText("Archived: AWSM tall fixture")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      completedPopup.getByRole("img", {
        name: "Screenshot thumbnail for AWSM tall fixture",
      }),
    ).toBeVisible();
    const capturePreview = completedPopup.getByRole("link", {
      name: "Open archived capture: AWSM tall fixture",
    });
    await expect(capturePreview).toHaveAttribute("href", /library\.html\?vaultId=[^&]+&bundleId=/u);
    const captureHref = await capturePreview.getAttribute("href");
    if (captureHref === null) throw new Error("The recent Capture link is unavailable.");
    const dismissRecent = completedPopup.getByRole("button", {
      name: "Dismiss recent capture: AWSM tall fixture",
    });
    await expect(dismissRecent).toBeVisible();
    expect(await dismissRecent.evaluate((node) => node.closest(".recent-capture") === null)).toBe(
      true,
    );
    await completedPopup.close();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const reopenedPopup = await extensionPopup(context, extensionId);
    await expect(reopenedPopup.getByText("Archived: AWSM tall fixture")).toHaveCount(0);
    await expect(reopenedPopup.getByRole("button", { name: "Archive this page" })).toBeVisible();
    const directCapturePage = await context.newPage();
    await directCapturePage.goto(captureHref);
    await expect(
      directCapturePage.getByRole("heading", { name: "AWSM tall fixture" }),
    ).toBeVisible();
    await expect(
      directCapturePage.getByRole("img", { name: /Full-page screenshot/u }),
    ).toBeVisible();
    await expect(
      directCapturePage.getByRole("link", {
        name: "Visit original site for AWSM tall fixture",
      }),
    ).toHaveAttribute("href", "http://127.0.0.1:4174/fixture");
    await directCapturePage.close();
    await fixturePage.evaluate(() => {
      const redBand = document.querySelector<HTMLElement>(".red");
      if (redBand === null) throw new Error("The evolving fixture band is unavailable.");
      redBand.style.background = "#7b4fc4";
      redBand.textContent = "purple evolution landmark";
    });
    await reopenedPopup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(value: unknown): Promise<readonly { id?: number; url?: string }[]>;
              update(id: number, value: unknown): Promise<unknown>;
            };
            runtime: {
              sendMessage(value: unknown, callback: (response: unknown) => void): void;
            };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      const state = await new Promise<{
        workspace: { activeVaultId?: string };
      }>((resolve) =>
        extensionApi.runtime.sendMessage({ type: "GetState" }, (response) => {
          const result = response as {
            value: { workspace: { activeVaultId?: string } };
          };
          resolve(result.value);
        }),
      );
      if (state.workspace.activeVaultId === undefined) throw new Error("No active Vault.");
      extensionApi.runtime.sendMessage(
        {
          type: "CaptureActivePage",
          expectedVaultId: state.workspace.activeVaultId,
          tabId: fixtureTab.id,
        },
        () => undefined,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    });
    await reopenedPopup.close();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
    await fixturePage.evaluate(() => history.pushState({}, "", "/fixture?different=1"));
    const popupAfterUrlChange = await extensionPopup(context, extensionId);
    await expect(popupAfterUrlChange.getByText("Archived: AWSM tall fixture")).toHaveCount(0);
    await popupAfterUrlChange.close();

    await context.setOffline(true);
    await context.addInitScript(() => {
      const saved = {
        aborted: false,
        chunks: [] as number[][],
        closed: false,
        suggestedName: "",
      };
      Object.defineProperty(window, "__awsmSavedArtifact", { value: saved });
      Object.defineProperty(window, "showSaveFilePicker", {
        value: async (options: { suggestedName: string }) => {
          saved.suggestedName = options.suggestedName;
          return {
            createWritable: async () => ({
              write: async (chunk: Uint8Array) => {
                saved.chunks.push(Array.from(chunk));
              },
              close: async () => {
                saved.closed = true;
              },
              abort: async () => {
                saved.aborted = true;
              },
            }),
          };
        },
      });
    });
    const library = await context.newPage();
    await library.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(library.getByRole("button", { name: "Import Vault" })).toBeVisible();
    await library.locator(".card").click();
    const firstSelection = library.getByRole("checkbox", { name: /Select capture from/u }).first();
    await firstSelection.check();
    await library.getByRole("button", { name: "Extract to new collection" }).click();
    await expect(library.locator(".library-card")).toHaveCount(2);
    await expect(library.getByRole("button", { name: "Undo" })).toBeVisible();
    await library.getByRole("button", { name: "Undo" }).click();
    await expect(library.locator(".library-card")).toHaveCount(1);
    await expect(library.getByText(/2 captures/u)).toBeVisible();

    await library.locator(".card").click();
    await library
      .getByRole("checkbox", { name: /Select capture from/u })
      .first()
      .check();
    await library.getByRole("button", { name: "Extract to new collection" }).click();
    await expect(library.locator(".library-card")).toHaveCount(2);
    const sourceCollection = library.locator(".library-card").first();
    const destinationCollection = library.locator(".library-card").nth(1);
    await library.evaluate(() => {
      const [source, destination] = document.querySelectorAll<HTMLElement>(".library-card");
      if (source === undefined || destination === undefined)
        throw new Error("Collection cards missing");
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
      destination.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }),
      );
    });
    await expect(destinationCollection).toHaveClass(/library-card--merge-target/u);
    await sourceCollection.dispatchEvent("dragend");
    await expect(destinationCollection).not.toHaveClass(/library-card--merge-target/u);
    await sourceCollection.dragTo(destinationCollection);
    await expect(library.locator(".library-card")).toHaveCount(1);
    await library.getByRole("button", { name: "Undo" }).click();
    await expect(library.locator(".library-card")).toHaveCount(2);

    await library.locator(".library-card .card").first().click();
    await library.getByRole("button", { name: "Move to collection…" }).click();
    const moveDialog = library.getByRole("dialog");
    await expect(moveDialog).toBeVisible();
    await moveDialog.getByRole("radio").check();
    await moveDialog.getByRole("button", { name: "Move to collection" }).click();
    await expect(library.locator(".library-card")).toHaveCount(1);
    await expect(library.getByText(/2 captures/u)).toBeVisible();
    const originalSite = library.getByRole("link", {
      name: "Visit original site for AWSM tall fixture",
    });
    await expect(originalSite).toHaveAttribute("href", "http://127.0.0.1:4174/fixture");
    await expect(originalSite).toHaveAttribute("target", "_blank");
    const latestThumbnail = library.getByRole("img", {
      name: "Latest screenshot thumbnail for AWSM tall fixture",
    });
    await expect(latestThumbnail).toBeVisible();
    const thumbnailDimensions = await latestThumbnail.evaluate((node) => {
      const image = node as HTMLImageElement;
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(thumbnailDimensions).toEqual({ width: 640, height: 360 });
    const collectionThumbnails = library.locator(".card__preview--stack .card__thumbnail");
    await expect(collectionThumbnails).toHaveCount(2);
    const collectionSources = await collectionThumbnails.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src),
    );
    expect(new Set(collectionSources).size).toBe(2);
    await expect(library.locator(".card")).toBeVisible();
    await library.locator(".card").click();
    await expect(library.getByRole("heading", { name: "AWSM tall fixture" })).toBeVisible();
    await expect(library.getByText("2 captures", { exact: true })).toBeVisible();
    await expect(library.locator(".version__thumbnail")).toHaveCount(2);
    await library.locator(".version").first().click();
    await expect(library.getByRole("heading", { name: "AWSM tall fixture" })).toBeVisible();
    const image = library.getByRole("img", { name: /Full-page screenshot/u });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const dimensions = await image.evaluate((node) => {
      const imageNode = node as HTMLImageElement;
      return { width: imageNode.naturalWidth, height: imageNode.naturalHeight };
    });
    expect(dimensions.height).toBeGreaterThan(1_800);
    expect(dimensions.width).toBeGreaterThan(500);
    const colors = await image.evaluate(async (node) => {
      const imageNode = node as HTMLImageElement;
      const bitmap = await createImageBitmap(await (await fetch(imageNode.src)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      const samples = [350, 1_050, 1_750].map((y) =>
        Array.from(context.getImageData(Math.floor(canvas.width / 4), y, 1, 1).data),
      );
      bitmap.close();
      return samples;
    });
    const [red, green, blue] = colors;
    if (
      (red?.[0] ?? 0) <= (red?.[1] ?? 0) + 40 ||
      (green?.[1] ?? 0) <= (green?.[0] ?? 0) + 40 ||
      (blue?.[2] ?? 0) <= (blue?.[0] ?? 0) + 40
    ) {
      throw new Error(`Unexpected screenshot landmarks: ${JSON.stringify({ colors, dimensions })}`);
    }
    expect(red?.[0]).toBeGreaterThan((red?.[1] ?? 0) + 40);
    expect(green?.[1]).toBeGreaterThan((green?.[0] ?? 0) + 40);
    expect(blue?.[2]).toBeGreaterThan((blue?.[0] ?? 0) + 40);

    const artifactPanel = library.getByRole("region", {
      name: "Capture Artifacts",
    });
    await expect(artifactPanel.locator(".artifact-row")).toHaveCount(5);
    const structuredArtifact = artifactPanel.locator(".artifact-row").filter({
      has: library.locator("strong", { hasText: /^CONTENT STRUCTURED$/u }),
    });
    await expect(structuredArtifact.getByRole("button", { name: "Inspect" })).toBeVisible();
    await structuredArtifact.getByRole("button", { name: "Inspect" }).focus();
    await expect(structuredArtifact.getByRole("button", { name: "Inspect" })).toBeFocused();
    await structuredArtifact.getByRole("button", { name: "Inspect" }).click();
    const inspection = library.locator(".artifact-inspection");
    await expect(inspection).toBeVisible();
    await expect(inspection.getByRole("heading", { name: "CONTENT STRUCTURED" })).toBeVisible();
    await expect(library.locator(".snackbar")).toHaveCount(0, {
      timeout: 15_000,
    });
    await library.setViewportSize({ width: 1280, height: 900 });
    await library.screenshot({
      path: testInfo.outputPath("artifact-detail-wide.png"),
      fullPage: true,
    });
    await library.setViewportSize({ width: 390, height: 844 });
    const artifactNarrowGeometry = await artifactPanel.evaluate((panel) => ({
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      panelWidth: panel.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    }));
    expect(artifactNarrowGeometry.documentOverflow).toBeLessThanOrEqual(0);
    expect(artifactNarrowGeometry.panelWidth).toBeLessThan(artifactNarrowGeometry.viewportWidth);
    await library.screenshot({
      path: testInfo.outputPath("artifact-detail-narrow.png"),
      fullPage: true,
    });
    await library.setViewportSize({ width: 1280, height: 720 });

    const storageAudit = await library.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const storeNames = Array.from(database.objectStoreNames);
      const transaction = database.transaction(storeNames, "readonly");
      const values = await Promise.all(
        storeNames.map(
          (storeName) =>
            new Promise<unknown[]>((resolveValues, reject) => {
              const request = transaction.objectStore(storeName).getAll();
              request.addEventListener("success", () => resolveValues(request.result), {
                once: true,
              });
              request.addEventListener("error", () => reject(request.error), {
                once: true,
              });
            }),
        ),
      );
      database.close();
      return {
        serialized: JSON.stringify(values),
        localStorageEntries: localStorage.length,
        cacheEntries: (await caches.keys()).length,
      };
    });
    for (const plaintext of [
      "http://127.0.0.1:4174/fixture",
      "AWSM tall fixture",
      "MIME-Version: 1.0",
      "red landmark",
    ]) {
      expect(storageAudit.serialized).not.toContain(plaintext);
    }
    expect(storageAudit.localStorageEntries).toBe(0);
    expect(storageAudit.cacheEntries).toBe(0);

    await library.getByRole("button", { name: "Export Vault" }).click();
    const exportDialog = library.getByRole("dialog", {
      name: "Export encrypted Vault",
    });
    await expect(exportDialog).toBeVisible();
    await expect(
      exportDialog.getByText(/not saved and does not unlock the local Vault/u),
    ).toBeVisible();
    await library.screenshot({
      path: testInfo.outputPath("export-dialog-wide.png"),
    });
    await library.setViewportSize({ width: 720, height: 900 });
    await library.screenshot({
      path: testInfo.outputPath("export-dialog-narrow.png"),
    });
    await expect(exportDialog.getByLabel("Export passphrase", { exact: true })).toBeVisible();
    await expect(exportDialog.getByLabel("Confirm export passphrase")).toBeVisible();
    await exportDialog.getByLabel("Export passphrase", { exact: true }).fill("too short");
    await exportDialog.getByLabel("Confirm export passphrase").fill("too short");
    await exportDialog.getByRole("button", { name: "Export Vault" }).click();
    await expect(
      exportDialog.getByText("Use at least 12 characters and no more than 1,024 UTF-8 bytes."),
    ).toBeVisible();
    await expect(exportDialog.getByLabel("Export passphrase", { exact: true })).toBeFocused();
    await exportDialog
      .getByLabel("Export passphrase", { exact: true })
      .fill("correct horse battery staple");
    await exportDialog
      .getByLabel("Confirm export passphrase")
      .fill("correct horse battery stapler");
    await exportDialog.getByRole("button", { name: "Export Vault" }).click();
    await expect(exportDialog.getByText("The passphrases do not match.")).toBeVisible();
    await expect(exportDialog.getByLabel("Confirm export passphrase")).toBeFocused();
    await exportDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(exportDialog).not.toBeVisible();
    await library.setViewportSize({ width: 1280, height: 720 });

    await expect(library.locator("iframe, object, embed")).toHaveCount(0);
    await expect(library.locator("body")).not.toHaveAttribute(
      "data-live-fixture",
      "executed-only-on-live-page",
    );
    const primaryArtifact = library
      .locator(".artifact-row")
      .filter({ has: library.locator("strong", { hasText: /^PRIMARY$/u }) });
    await primaryArtifact.getByRole("button", { name: "Download" }).click();
    await expect
      .poll(() =>
        library.evaluate(
          () =>
            (
              window as typeof window & {
                __awsmSavedArtifact: { closed: boolean };
              }
            ).__awsmSavedArtifact.closed,
        ),
      )
      .toBe(true);
    const savedPrimary = await library.evaluate(
      () =>
        (
          window as typeof window & {
            __awsmSavedArtifact: {
              aborted: boolean;
              chunks: number[][];
              suggestedName: string;
            };
          }
        ).__awsmSavedArtifact,
    );
    expect(savedPrimary.suggestedName).toMatch(/-primary\.mhtml$/u);
    expect(savedPrimary.aborted).toBe(false);
    const mhtml = new TextDecoder().decode(Uint8Array.from(savedPrimary.chunks.flat()));
    expect(mhtml).toContain("MIME-Version: 1.0");
    expect(mhtml).toContain("AWSM tall fixture");
    await expect(library.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
      "AWSM tall fixture",
    );
    await library.getByRole("button", { name: "Library", exact: true }).click();
    await expect(library.locator(".deleted-section")).not.toHaveAttribute("open", "");
    library.once("dialog", async (dialog) => dialog.dismiss());
    await library.getByRole("button", { name: "Delete AWSM tall fixture collection" }).click();
    await expect(library.getByText("2 captures", { exact: false })).toBeVisible();
    library.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("remain accessible and restorable in Deleted");
      expect(dialog.message()).toContain("Vault Vacuum");
      await dialog.accept();
    });
    await library.getByRole("button", { name: "Delete AWSM tall fixture collection" }).click();
    await expect(library.getByText(/No captures yet/u)).toBeVisible();
    await library.getByText("Deleted (2)", { exact: true }).click();
    await expect(library.getByText("2 captures", { exact: false })).toBeVisible();
    await library.locator(".card").click();
    await expect(library.getByRole("heading", { name: "AWSM tall fixture" })).toBeVisible();
    await expect(library.locator(".version__thumbnail")).toHaveCount(2);
    await library.getByRole("button", { name: "← Deleted" }).click();
    library.once("dialog", async (dialog) => dialog.dismiss());
    await library.getByRole("button", { name: "Restore AWSM tall fixture collection" }).click();
    await expect(library.getByText("2 captures", { exact: false })).toBeVisible();
    library.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Restore “AWSM tall fixture” (2 captures)");
      await dialog.accept();
    });
    await library.getByRole("button", { name: "Restore AWSM tall fixture collection" }).click();
    await expect(library.getByText("Deleted is empty.")).toBeVisible();
    await expect(library.getByText("2 captures", { exact: false })).toBeVisible();
    await expect(library.getByRole("button", { name: "Vacuum Vault" })).toHaveCount(0);
    await library.locator(".card").click();
    await library.locator(".version").first().click();
    library.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("remain accessible and restorable in Deleted");
      await dialog.accept();
    });
    await library.getByRole("button", { name: "Delete capture" }).click();
    await expect(library.getByText("Deleted (1)", { exact: true })).toBeVisible();
    await library.getByText("Deleted (1)", { exact: true }).click();
    await library.locator(".deleted-section .card").click();
    await expect(library.getByRole("img", { name: /Full-page screenshot/u })).toBeVisible();
    await library.evaluate(() => {
      const saved = (
        window as typeof window & {
          __awsmSavedArtifact: {
            aborted: boolean;
            chunks: number[][];
            closed: boolean;
          };
        }
      ).__awsmSavedArtifact;
      saved.aborted = false;
      saved.chunks = [];
      saved.closed = false;
    });
    const deletedPrimaryArtifact = library
      .locator(".artifact-row")
      .filter({ has: library.locator("strong", { hasText: /^PRIMARY$/u }) });
    await deletedPrimaryArtifact.getByRole("button", { name: "Download" }).click();
    await expect
      .poll(() =>
        library.evaluate(
          () =>
            (
              window as typeof window & {
                __awsmSavedArtifact: { closed: boolean };
              }
            ).__awsmSavedArtifact.closed,
        ),
      )
      .toBe(true);
    library.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Restore “AWSM tall fixture” (1 capture)");
      await dialog.accept();
    });
    await library.getByRole("button", { name: "Restore capture" }).click();
    await expect(library.getByText("Deleted is empty.")).toBeVisible();
    await library.locator(".card").click();
    await library.locator(".version").first().click();
    library.once("dialog", async (dialog) => dialog.accept());
    await library.getByRole("button", { name: "Delete capture" }).click();
    await expect(library.getByText("Deleted (1)", { exact: true })).toBeVisible();
    const objectsBeforeVacuum = await library.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const transaction = database.transaction("objects", "readonly");
      const count = await new Promise<number>((resolveCount, reject) => {
        const request = transaction.objectStore("objects").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      database.close();
      return count;
    });
    await library.getByText("Deleted (1)", { exact: true }).click();
    await expect(
      library.locator(".deleted-section .card").getByText("1 capture", { exact: false }),
    ).toBeVisible();
    library.once("dialog", async (dialog) => dialog.dismiss());
    await library.getByRole("button", { name: "Vacuum Vault" }).click();
    await expect(
      library.locator(".deleted-section .card").getByText("1 capture", { exact: false }),
    ).toBeVisible();
    library.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("permanently remove 1 deleted capture");
      expect(dialog.message()).toContain("has no undo");
      await dialog.accept();
    });
    await library.getByRole("button", { name: "Vacuum Vault" }).click();
    await expect(library.getByText("Deleted is empty.")).toBeVisible();
    await library.locator(".card").click();
    await expect(library.getByRole("img", { name: /Full-page screenshot/u })).toBeVisible();
    const vacuumStorage = await library.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const transaction = database.transaction("objects", "readonly");
      const count = await new Promise<number>((resolveCount, reject) => {
        const request = transaction.objectStore("objects").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const generationTransaction = database.transaction(
        ["vault_head", "vault_generations"],
        "readonly",
      );
      const head = await new Promise<Record<string, unknown>>((resolveHead, reject) => {
        const request = generationTransaction.objectStore("vault_head").getAll();
        request.addEventListener("success", () => resolveHead(request.result[0]), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const generationCount = await new Promise<number>((resolveCount, reject) => {
        const request = generationTransaction.objectStore("vault_generations").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      database.close();
      return { objectCount: count, head, generationCount };
    });
    expect(vacuumStorage.objectCount).toBeLessThan(objectsBeforeVacuum);
    expect(vacuumStorage.generationCount).toBe(1);
    expect(vacuumStorage.head).toMatchObject({
      version: 1,
      generationNumber: 1,
    });
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("exports a Vault and imports it into a fresh Workspace", async ({ browserName }, testInfo) => {
  test.setTimeout(120_000);
  expect(browserName).toBe("chromium");
  const extensionPath = testInfo.outputPath("portable-extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const packagePath = testInfo.outputPath("portable-vault.awsm");
  const selectivePackagePath = testInfo.outputPath("selective-vault.awsm");
  const invalidPackagePath = testInfo.outputPath("invalid-vault.awsm");
  class MemoryVaultRepository implements VaultRepository {
    records: VaultRecordsV1 | undefined;
    async load(): Promise<VaultRecordsV1 | undefined> {
      return this.records;
    }
    async setManualLock(): Promise<void> {}
  }
  const repository = new MemoryVaultRepository();
  const preparer = new VaultService(repository);
  const prepared = await preparer.prepareCreate({
    name: "Portable Archive",
    createdAt: "2026-07-19T03:00:00.000Z",
  });
  repository.records = prepared.records;
  const vault = new VaultService(repository, prepared.records.metadata.vaultId);
  vault.activatePrepared(prepared);
  const created = await prepareVaultNameChange({
    rootKey: prepared.rootKey,
    eventType: "VaultCreated",
    vaultId: prepared.records.metadata.vaultId,
    deviceId: prepared.records.metadata.deviceId,
    eventId: crypto.randomUUID(),
    timestamp: prepared.records.metadata.createdAt,
    name: prepared.name,
  });
  const capturedAt = "2026-07-19T03:00:30.000Z";
  const metadata: CaptureMetadataV1 = {
    version: 1,
    originalUrl: "https://fixture.test/portable",
    finalUrl: "https://fixture.test/portable",
    title: "Portable Fixture",
    capturedAt,
    contentType: "text/html",
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1200 },
    chromeVersion: "149",
    extensionVersion: "0.1.0",
    captureProfileId: "ChromeWebPage-v1",
    captureProfileVersion: 1,
  };
  const blocks = [
    {
      blockVersion: 1 as const,
      blockId: "B000001",
      kind: "Paragraph" as const,
      text: "Portable fixture text",
      links: [],
    },
  ];
  const encryptedArtifacts = new Map<string, Uint8Array>();
  const primary = new Uint8Array(32 * 1024 * 1024).fill(0x20);
  primary.set(new TextEncoder().encode("MIME-Version: 1.0\r\nPortable Fixture\r\n"));
  const artifacts = await Promise.all([
    preparePortableArtifact(
      encryptedArtifacts,
      prepared.rootKey,
      prepared.records.metadata.vaultId,
      primary,
      "PRIMARY",
      "CAPTURE",
      "multipart/related",
      capturedAt,
    ),
    preparePortableArtifact(
      encryptedArtifacts,
      prepared.rootKey,
      prepared.records.metadata.vaultId,
      normalizedTextFromBlocks(blocks),
      "TEXT_EXTRACTED",
      "TEXT",
      "text/plain;charset=utf-8",
      capturedAt,
    ),
    preparePortableArtifact(
      encryptedArtifacts,
      prepared.rootKey,
      prepared.records.metadata.vaultId,
      encodeStructuredContentSequence(blocks),
      "CONTENT_STRUCTURED",
      "STRUCTURED_CONTENT",
      "application/cbor-seq",
      capturedAt,
    ),
  ]);
  const registration = await prepareCaptureRegistration({
    rootKey: prepared.rootKey,
    vaultId: prepared.records.metadata.vaultId,
    deviceId: prepared.records.metadata.deviceId,
    commandId: crypto.randomUUID(),
    bundleId: crypto.randomUUID(),
    descriptorObjectId: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    capturedAt,
    metadata,
    artifacts,
    warnings: ["OPTIONAL_METADATA_UNAVAILABLE"],
    clientVersion: "0.1.0",
  });
  const head = {
    ...prepared.records.head,
    appendedEventIds: [created.event.eventId, registration.event.eventId].toSorted(),
    appendedObjectIds: registration.objects.map((object) => object.objectId).toSorted(),
  };
  const events = new Map<string, StoredEvent>([
    [created.event.eventId, created.event],
    [registration.event.eventId, registration.event],
  ]);
  const objects = new Map<string, StoredObjectV1>(
    registration.objects.map((object) => [object.objectId, object]),
  );
  const source: VaultExportSource = {
    getVaultHead: () => Promise.resolve(head),
    getVaultGeneration: () => Promise.resolve(prepared.records.generation),
    getStoredEvent: (eventId) => Promise.resolve(events.get(eventId)),
    getStoredObject: (objectId) => Promise.resolve(objects.get(objectId)),
    listAuthoritativeIds: () =>
      Promise.resolve({
        eventIds: [...events.keys()].toSorted(),
        objectIds: [...objects.keys()].toSorted(),
      }),
  };
  const exportService = new VaultExportService(source, vault, prepared.records.metadata.vaultId, {
    openEncrypted: (_vaultId: string, objectId: string) => {
      const bytes = encryptedArtifacts.get(objectId);
      if (bytes === undefined) return Promise.reject(new Error("Artifact is missing."));
      return Promise.resolve(new Blob([Uint8Array.from(bytes).buffer]).stream());
    },
  } as unknown as ArtifactStore);
  const exportOptions = {
    packageId: crypto.randomUUID(),
    createdAt: "2026-07-19T03:01:00.000Z",
    passphrase: "portable package passphrase",
    salt: crypto.getRandomValues(new Uint8Array(16)),
    nonce: crypto.getRandomValues(new Uint8Array(24)),
  };
  const exported = await exportService.prepare(exportOptions);
  const output = new BlobWriter("application/vnd.awsm.vault+zip");
  await writeVaultPackage(output, exported.entries);
  await writeFile(packagePath, new Uint8Array(await (await output.getData()).arrayBuffer()));
  const selective = await exportService.prepare({
    ...exportOptions,
    packageId: crypto.randomUUID(),
    nonce: crypto.getRandomValues(new Uint8Array(24)),
    omitArtifactObjectIds: new Set([artifacts[0].object.objectId]),
  });
  const selectiveOutput = new BlobWriter("application/vnd.awsm.vault+zip");
  await writeVaultPackage(selectiveOutput, selective.entries);
  await writeFile(
    selectivePackagePath,
    new Uint8Array(await (await selectiveOutput.getData()).arrayBuffer()),
  );
  await writeFile(invalidPackagePath, new TextEncoder().encode("not a Vault Package"));
  const launch = (profile: string) =>
    chromium.launchPersistentContext(testInfo.outputPath(profile), {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

  const destination = await launch("portable-destination-profile");
  try {
    const worker =
      destination.serviceWorkers()[0] ?? (await destination.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const observer = await destination.newPage();
    await observer.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(
      observer.getByRole("heading", { name: "Create or import your first Vault" }),
    ).toBeVisible();
    const library = await destination.newPage();
    await library.goto(`chrome-extension://${extensionId}/library.html?import=1`);
    const dialog = library.getByRole("dialog", {
      name: "Import encrypted Vault",
    });
    await expect(dialog).toBeVisible();
    await library.setViewportSize({ width: 1280, height: 900 });
    await library.screenshot({
      path: testInfo.outputPath("import-select-wide.png"),
      fullPage: true,
    });
    await dialog.getByLabel("Vault Package").setInputFiles(packagePath);
    await library.screenshot({
      path: testInfo.outputPath("import-select-file-wide.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Continue" })
      .evaluate((button) => (button as HTMLElement).click());
    if (
      await dialog
        .getByRole("progressbar")
        .isVisible()
        .catch(() => false)
    ) {
      await library.screenshot({
        path: testInfo.outputPath("import-acquire-wide.png"),
        fullPage: true,
      });
    }
    await observer.getByRole("button", { name: "Cancel Import" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await library.screenshot({
      path: testInfo.outputPath("import-cancellation-restored-wide.png"),
      fullPage: true,
    });
    await library.getByRole("button", { name: "Import existing Vault" }).click();
    await dialog.getByLabel("Vault Package").setInputFiles(packagePath);
    await dialog.getByRole("button", { name: "Continue" }).click();
    const passphrase = dialog.getByLabel("Export passphrase");
    await expect(passphrase).toBeVisible({ timeout: 30_000 });
    await expect(observer.getByText(/Import · Authenticate/u)).toBeVisible();
    await expect(observer.getByRole("button", { name: "Cancel Import" })).toBeVisible();
    await library.setViewportSize({ width: 390, height: 844 });
    await library.screenshot({
      path: testInfo.outputPath("import-authenticate-narrow.png"),
      fullPage: true,
    });
    await passphrase.fill("incorrect package passphrase");
    await dialog.getByRole("button", { name: "Import Vault" }).click();
    await expect(dialog.getByRole("alert")).toContainText("could not be authenticated");
    await expect(dialog.getByLabel("Export passphrase")).toBeFocused();
    await library.screenshot({
      path: testInfo.outputPath("import-authentication-error-narrow.png"),
      fullPage: true,
    });
    await dialog.getByLabel("Export passphrase").fill("portable package passphrase");
    await dialog.getByRole("button", { name: "Import Vault" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await expect(library.getByRole("heading", { name: "Portable Archive" })).toBeVisible();
    await expect(observer.getByRole("heading", { name: "Portable Archive" })).toBeVisible();
    await expect(library.getByRole("button", { name: "Unlock on this device" })).toBeVisible();
    await library.getByRole("button", { name: "Unlock on this device" }).click();
    await expect(library.getByText("Portable Fixture")).toBeVisible();
    await library.getByText("Portable Fixture").click();
    await library
      .locator("article.artifact-row")
      .filter({ hasText: "TEXT EXTRACTED" })
      .getByRole("button", { name: "Inspect" })
      .click();
    await expect(library.getByText("Portable fixture text")).toBeVisible();
    await expect(library.getByText(/OPTIONAL_METADATA_UNAVAILABLE/u)).toBeVisible();
    await library.getByRole("button", { name: "Export Vault" }).click();
    const reexportDialog = library.getByRole("dialog", { name: "Export encrypted Vault" });
    await reexportDialog
      .getByLabel("Export passphrase", { exact: true })
      .fill("re-exported package passphrase");
    await reexportDialog
      .getByLabel("Confirm export passphrase")
      .fill("re-exported package passphrase");
    await reexportDialog.getByRole("button", { name: "Export Vault" }).click();
    await expect(reexportDialog).not.toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        library.evaluate(
          () =>
            new Promise((resolve) => {
              const extensionApi = (
                globalThis as unknown as {
                  chrome: {
                    runtime: {
                      sendMessage(value: unknown, callback: (response: unknown) => void): void;
                    };
                  };
                }
              ).chrome;
              extensionApi.runtime.sendMessage({ type: "GetState" }, (response) => {
                resolve(
                  (response as { value: { latestExportJob?: unknown } }).value.latestExportJob,
                );
              });
            }),
        ),
      )
      .toMatchObject({ state: "Failed", stage: "Download", errorId: "EXPORT_DOWNLOAD_FAILED" });
    await expect(library.getByText("The last Vault Export failed safely.")).toBeVisible({
      timeout: 30_000,
    });
    await library.setViewportSize({ width: 1280, height: 900 });
    await library.screenshot({
      path: testInfo.outputPath("import-success-wide.png"),
      fullPage: true,
    });
    const expectTerminalImportFailure = async (
      sourcePath: string,
      expectedMessage: RegExp,
      screenshotName: string,
      authenticated: boolean,
    ): Promise<void> => {
      await library.getByRole("button", { name: "Import Vault" }).click();
      const failureDialog = library.getByRole("dialog", { name: "Import encrypted Vault" });
      await failureDialog.getByLabel("Vault Package").setInputFiles(sourcePath);
      await failureDialog.getByRole("button", { name: "Continue" }).click();
      await failureDialog.getByLabel("Export passphrase").fill("portable package passphrase");
      await failureDialog.getByRole("button", { name: "Import Vault" }).click();
      if (authenticated) {
        await expect(failureDialog).not.toBeVisible({ timeout: 30_000 });
        await expect(
          library.locator("#vault-management .notice.error").filter({ hasText: expectedMessage }),
        ).toBeVisible({ timeout: 30_000 });
      } else {
        await expect(failureDialog.getByRole("alert")).toContainText(expectedMessage, {
          timeout: 30_000,
        });
      }
      await library.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true });
      if (!authenticated) await failureDialog.getByRole("button", { name: "Close" }).click();
    };
    await library.setViewportSize({ width: 390, height: 844 });
    await expectTerminalImportFailure(
      packagePath,
      /already exists/u,
      "import-collision-actual-narrow.png",
      true,
    );
    await expectTerminalImportFailure(
      selectivePackagePath,
      /only Complete Vault Packages/u,
      "import-selective-actual-narrow.png",
      true,
    );
    await expectTerminalImportFailure(
      invalidPackagePath,
      /incomplete, corrupt, or unsupported/u,
      "import-invalid-actual-narrow.png",
      false,
    );
  } finally {
    await destination.close();
  }

  const populatedDestination = await launch("portable-populated-destination-profile");
  try {
    const worker =
      populatedDestination.serviceWorkers()[0] ??
      (await populatedDestination.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const popup = await extensionPopup(populatedDestination, extensionId);
    await popup.getByRole("textbox", { name: "Vault name" }).fill("Existing Vault");
    await popup.getByRole("button", { name: "Create Vault" }).click();
    await expect(popup.getByText(/Vault · Existing Vault · Unlocked/u)).toBeVisible();
    const library = await populatedDestination.newPage();
    await library.goto(`chrome-extension://${extensionId}/library.html?import=1`);
    const dialog = library.getByRole("dialog", { name: "Import encrypted Vault" });
    await dialog.getByLabel("Vault Package").setInputFiles(packagePath);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Export passphrase").fill("portable package passphrase");
    await dialog.getByRole("button", { name: "Import Vault" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await expect(library.getByRole("heading", { name: "Existing Vault" })).toBeVisible();
    const switchToImported = library.getByRole("button", { name: "Switch to imported Vault" });
    await expect(switchToImported).toBeVisible();
    await library.screenshot({
      path: testInfo.outputPath("import-success-existing-active-wide.png"),
      fullPage: true,
    });
    await switchToImported.click();
    await expect(library.getByRole("heading", { name: "Portable Archive" })).toBeVisible();
    await expect(library.getByRole("button", { name: "Unlock on this device" })).toBeVisible();
    await library.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(library.getByRole("heading", { name: "Portable Archive" })).toBeVisible();
    for (const stage of ["Validate", "Prepare", "Rebuild", "Commit"] as const) {
      await setLatestImportJobForVisual(library, {
        state: "Running",
        stage,
        completedEntries: stage === "Validate" ? 0 : 2,
        totalEntries: 5,
        processedBytes: stage === "Prepare" ? 16 * 1024 * 1024 : 0,
        totalBytes: stage === "Prepare" ? 32 * 1024 * 1024 : 0,
        cancellationRequested: stage === "Commit",
        errorId: null,
      });
      await library.reload();
      await expect(library.getByText(new RegExp(`Import · ${stage}`, "u"))).toBeVisible();
      const cancelImport = library.getByRole("button", { name: "Cancel Import" });
      await expect(cancelImport).toBeVisible();
      await expect(library.getByRole("button", { name: "Unlock on this device" })).toBeDisabled();
      if (stage === "Commit") await expect(cancelImport).toBeDisabled();
      await library.screenshot({
        path: testInfo.outputPath(`import-${stage.toLowerCase()}-progress-wide.png`),
        fullPage: true,
      });
    }
    const failureStates = [
      ["IMPORT_PACKAGE_INVALID", "invalid"],
      ["SELECTIVE_IMPORT_UNSUPPORTED", "selective"],
      ["VAULT_ALREADY_EXISTS", "collision"],
      ["STORAGE_QUOTA_EXCEEDED", "quota"],
    ] as const;
    await library.setViewportSize({ width: 390, height: 844 });
    for (const [errorId, screenshotName] of failureStates) {
      await setLatestImportJobForVisual(library, {
        state: "Failed",
        stage: "Commit",
        cancellationRequested: false,
        errorId,
      });
      await library.reload();
      await expect(library.locator("#vault-management .notice.error")).toBeVisible();
      await library.screenshot({
        path: testInfo.outputPath(`import-${screenshotName}-failure-narrow.png`),
        fullPage: true,
      });
    }
    await setLatestImportJobForVisual(library, {
      state: "Succeeded",
      stage: "Commit",
      cancellationRequested: false,
      errorId: null,
    });
    await library.reload();
    await library.setViewportSize({ width: 1280, height: 900 });
    await expect(library.getByRole("heading", { name: "Portable Archive" })).toBeVisible();
    await expect(library.getByRole("button", { name: "Unlock on this device" })).toBeVisible();
  } finally {
    await populatedDestination.close();
  }
});

test("creates, captures, switches, locks, renames, and deep-links across isolated Vaults", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const extensionPath = testInfo.outputPath("extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(testInfo.outputPath("chrome-profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    await Promise.all(context.pages().map((page) => page.close()));
    const fixture = await context.newPage();
    await fixture.goto("http://127.0.0.1:4174/fixture");
    const popup = await extensionPopup(context, extensionId);
    const activateFixture = async (): Promise<void> => {
      await popup.evaluate(async () => {
        const extensionApi = (
          globalThis as unknown as {
            chrome: {
              tabs: {
                query(value: unknown): Promise<readonly { id?: number; url?: string }[]>;
                update(id: number, value: unknown): Promise<unknown>;
              };
            };
          }
        ).chrome;
        const tabs = await extensionApi.tabs.query({ currentWindow: true });
        const target = tabs.find((tab) => tab.url === "http://127.0.0.1:4174/fixture");
        if (target?.id === undefined) throw new Error("Fixture tab is unavailable.");
        await extensionApi.tabs.update(target.id, { active: true });
      });
    };
    const name = popup.getByRole("textbox", { name: "Vault name" });
    await expect(name).toBeVisible();
    await name.fill("Vault A");
    await popup.getByRole("button", { name: "Create Vault" }).click();
    await expect(popup.getByText(/Vault · Vault A · Unlocked/u)).toBeVisible();

    await activateFixture();
    await popup.getByRole("button", { name: "Archive this page" }).click();
    await expect(popup.getByRole("button", { name: "Switch Vault" })).toBeDisabled();
    await expect(popup.getByRole("link", { name: /Open archived capture/u })).toBeVisible({
      timeout: 30_000,
    });

    await popup.getByRole("button", { name: "Switch Vault" }).click();
    await popup.getByRole("button", { name: "Create another Vault" }).click();
    const createDialog = popup.getByRole("dialog", {
      name: "Create another Vault",
    });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole("textbox", { name: "Vault name" }).fill("Vault B");
    await createDialog.getByRole("button", { name: "Create Vault" }).click();
    await expect(popup.getByText(/Vault · Vault B · Unlocked/u)).toBeVisible();
    const liveLibraryB = await context.newPage();
    await liveLibraryB.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(liveLibraryB.getByRole("heading", { name: "Vault B" })).toBeVisible();

    await activateFixture();
    await popup.getByRole("button", { name: "Archive this page" }).click();
    await expect(liveLibraryB.getByRole("button", { name: "Switch Vault" })).toBeDisabled();
    await expect(popup.getByRole("link", { name: /Open archived capture/u })).toBeVisible({
      timeout: 30_000,
    });
    await expect(liveLibraryB.getByText("AWSM tall fixture", { exact: true })).toBeVisible();
    await liveLibraryB.close();

    const state = await popup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            runtime: { sendMessage(message: unknown): Promise<unknown> };
          };
        }
      ).chrome;
      const response = (await extensionApi.runtime.sendMessage({
        type: "GetState",
      })) as {
        value: {
          workspace: {
            activeVaultId: string;
            vaults: readonly { vaultId: string; name: string }[];
          };
        };
      };
      return response.value.workspace;
    });
    const vaultA = state.vaults.find((vault) => vault.name === "Vault A");
    const vaultB = state.vaults.find((vault) => vault.name === "Vault B");
    if (vaultA === undefined || vaultB === undefined) throw new Error("Expected both Vaults.");
    expect(state.activeVaultId).toBe(vaultB.vaultId);

    const scopedObjectCounts = await popup.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const transaction = database.transaction("objects", "readonly");
      const keys = await new Promise<IDBValidKey[]>((resolveKeys, reject) => {
        const request = transaction.objectStore("objects").getAllKeys();
        request.addEventListener("success", () => resolveKeys(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      database.close();
      return keys.reduce<Record<string, number>>((counts, key) => {
        if (Array.isArray(key) && typeof key[0] === "string") {
          counts[key[0]] = (counts[key[0]] ?? 0) + 1;
        }
        return counts;
      }, {});
    });
    expect(scopedObjectCounts).toMatchObject({
      [vaultA.vaultId]: 6,
      [vaultB.vaultId]: 6,
    });

    await popup.getByRole("button", { name: "Switch Vault" }).click();
    const switchDialog = popup.getByRole("dialog", { name: "Switch Vault" });
    await switchDialog.getByRole("radio", { name: /Vault A/u }).check();
    await switchDialog.getByRole("button", { name: "Switch", exact: true }).click();
    await expect(popup.getByText(/Vault · Vault A · Locked/u)).toBeVisible();
    const libraryA = await context.newPage();
    await libraryA.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(libraryA.getByRole("heading", { name: "Vault A" })).toBeVisible();
    await expect(libraryA.getByRole("button", { name: "Rename Vault A" })).toHaveCount(0);
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-locked-desktop.png"),
    });
    await popup.getByRole("button", { name: "Unlock on this device" }).click();
    await expect(popup.getByText(/Vault · Vault A · Unlocked/u)).toBeVisible();

    await expect(popup.getByRole("button", { name: /^Rename/u })).toHaveCount(0);
    await expect(libraryA.getByRole("button", { name: "Rename Vault A" })).toBeVisible();
    await popup.getByRole("button", { name: "Lock Vault" }).click();
    await expect(libraryA.getByRole("heading", { name: "Vault A" })).toBeVisible();
    await expect(libraryA.getByRole("button", { name: "Rename Vault A" })).toHaveCount(0);
    await expect(libraryA.getByRole("heading", { name: "Unlock your Vault" })).toBeVisible();
    await popup.getByRole("button", { name: "Unlock on this device" }).click();
    await expect(libraryA.getByRole("button", { name: "Rename Vault A" })).toBeVisible();
    const restingGeometry = await libraryA.evaluate(() => {
      const header = document.querySelector("header")?.getBoundingClientRect();
      const management = document.querySelector(".vault-control")?.getBoundingClientRect();
      const main = document.querySelector("main")?.getBoundingClientRect();
      if (header === undefined || management === undefined || main === undefined) {
        throw new Error("Library layout is incomplete.");
      }
      return {
        headerBottom: header.bottom,
        mainTop: main.top,
        leftEdges: [header.left, management.left, main.left],
      };
    });
    expect(
      Math.max(...restingGeometry.leftEdges) - Math.min(...restingGeometry.leftEdges),
    ).toBeLessThan(1);
    await libraryA.evaluate(() => window.scrollTo(0, 0));
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-resting-desktop.png"),
    });
    await libraryA.getByRole("button", { name: "Rename Vault A" }).click();
    const selectedInput = libraryA.getByRole("textbox", { name: "Vault name" });
    await expect(selectedInput).toBeVisible();
    await expect(selectedInput).toHaveCount(1);
    await expect(selectedInput).toHaveJSProperty("selectionStart", 0);
    await expect(selectedInput).toHaveJSProperty("selectionEnd", "Vault A".length);
    const editingGeometry = await libraryA.evaluate(() => ({
      headerBottom: document.querySelector("header")?.getBoundingClientRect().bottom,
      mainTop: document.querySelector("main")?.getBoundingClientRect().top,
    }));
    expect(editingGeometry).toEqual({
      headerBottom: restingGeometry.headerBottom,
      mainTop: restingGeometry.mainTop,
    });
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-selected-desktop.png"),
    });
    await selectedInput.pressSequentially("Discarded draft");
    await expect(selectedInput).toHaveValue("Discarded draft");
    await libraryA.locator(".eyebrow").click();
    await expect(libraryA.getByRole("heading", { name: "Vault A" })).toBeVisible();
    await expect(libraryA.getByRole("textbox", { name: "Vault name" })).toHaveCount(0);
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-restored-desktop.png"),
    });
    await libraryA.getByRole("button", { name: "Rename Vault A" }).click();
    await expect(libraryA.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await libraryA.getByRole("textbox", { name: "Vault name" }).fill(" ");
    await libraryA.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(libraryA.getByText(/Use a Vault name between 1 and 64/u)).toBeVisible();
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-error-desktop.png"),
    });
    await libraryA.getByRole("textbox", { name: "Vault name" }).press("Escape");
    await expect(libraryA.getByRole("heading", { name: "Vault A" })).toBeVisible();
    await libraryA.getByRole("button", { name: "Rename Vault A" }).click();
    await libraryA.getByRole("textbox", { name: "Vault name" }).fill("Escaped draft");
    await libraryA.getByRole("textbox", { name: "Vault name" }).press("Escape");
    await expect(libraryA.getByRole("heading", { name: "Vault A" })).toBeVisible();
    await libraryA.getByRole("button", { name: "Rename Vault A" }).click();
    const renameInput = libraryA.getByRole("textbox", { name: "Vault name" });
    await renameInput.fill("Vault A Renamed");
    await libraryA.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(libraryA.getByRole("heading", { name: "Vault A Renamed" })).toBeVisible();
    await expect(popup.getByText(/Vault · Vault A Renamed · Unlocked/u)).toBeVisible();
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-success-desktop.png"),
    });
    await libraryA.setViewportSize({ width: 390, height: 844 });
    await libraryA.getByRole("button", { name: "Rename Vault A Renamed" }).click();
    await expect(libraryA.getByRole("textbox", { name: "Vault name" })).toBeVisible();
    const narrowLayout = await libraryA.evaluate(() => {
      const header = document.querySelector("header")?.getBoundingClientRect();
      const management = document.querySelector(".vault-control")?.getBoundingClientRect();
      const main = document.querySelector("main")?.getBoundingClientRect();
      if (header === undefined || management === undefined || main === undefined) {
        throw new Error("Library layout is incomplete.");
      }
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        leftEdges: [header.left, management.left, main.left],
      };
    });
    expect(narrowLayout.overflow).toBeLessThanOrEqual(0);
    expect(Math.max(...narrowLayout.leftEdges) - Math.min(...narrowLayout.leftEdges)).toBeLessThan(
      1,
    );
    await libraryA.screenshot({
      path: testInfo.outputPath("vault-title-selected-narrow.png"),
    });
    await libraryA.getByRole("textbox", { name: "Vault name" }).press("Escape");

    const deepLinkLibrary = await context.newPage();
    await deepLinkLibrary.goto(
      `chrome-extension://${extensionId}/library.html?vaultId=${encodeURIComponent(vaultB.vaultId)}&bundleId=00000000-0000-4000-8000-000000000999`,
    );
    await expect(
      deepLinkLibrary.getByRole("heading", { name: /Switch to Vault B/u }),
    ).toBeVisible();
    await expect(
      deepLinkLibrary.getByRole("button", { name: "Switch to this Vault" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("worker termination during acquisition leaves no partial authoritative capture", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const extensionPath = testInfo.outputPath("extension");
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(testInfo.outputPath("chrome-profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    await Promise.all(context.pages().map((page) => page.close()));
    const fixturePage = await context.newPage();
    await fixturePage.goto("http://127.0.0.1:4174/fixture");
    const cdp = await context.newCDPSession(fixturePage);
    const serviceWorkerVersion = new Promise<string>((resolveVersion) => {
      cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
        const extensionVersion = versions.find((version) => version.scriptURL === worker.url());
        if (extensionVersion !== undefined) resolveVersion(extensionVersion.versionId);
      });
    });
    await cdp.send("ServiceWorker.enable");
    const serviceWorkerVersionId = await serviceWorkerVersion;
    const popup = await extensionPopup(context, extensionId);
    await popup.getByRole("button", { name: "Create Vault" }).click();
    await expect(popup.getByRole("button", { name: "Archive this page" })).toBeVisible();
    await popup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(value: unknown): Promise<readonly { id?: number; url?: string }[]>;
              update(id: number, value: unknown): Promise<unknown>;
            };
            runtime: {
              sendMessage(value: unknown, callback: (response: unknown) => void): void;
            };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      const state = await new Promise<{
        workspace: { activeVaultId?: string };
      }>((resolve) =>
        extensionApi.runtime.sendMessage({ type: "GetState" }, (response) => {
          const result = response as {
            value: { workspace: { activeVaultId?: string } };
          };
          resolve(result.value);
        }),
      );
      if (state.workspace.activeVaultId === undefined) throw new Error("No active Vault.");
      extensionApi.runtime.sendMessage(
        {
          type: "CaptureActivePage",
          expectedVaultId: state.workspace.activeVaultId,
          tabId: fixtureTab.id,
        },
        () => undefined,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    });
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
            const request = indexedDB.open("awsm-vault");
            request.addEventListener("success", () => resolveDatabase(request.result), {
              once: true,
            });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          });
          const transaction = database.transaction("capture_jobs", "readonly");
          const jobs = await new Promise<readonly { state?: unknown }[]>((resolveJobs, reject) => {
            const request = transaction.objectStore("capture_jobs").getAll();
            request.addEventListener("success", () => resolveJobs(request.result), { once: true });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          });
          database.close();
          return jobs.at(-1)?.state;
        }),
      )
      .toBe("Running");
    await cdp.send("ServiceWorker.stopWorker", {
      versionId: serviceWorkerVersionId,
    });
    await popup.close();
    const restartedPopup = await extensionPopup(context, extensionId);
    await expect(restartedPopup.getByText(/CAPTURE_INTERRUPTED/u)).toBeVisible({
      timeout: 30_000,
    });
    const counts = await restartedPopup.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const names = ["objects", "events", "library_projection", "command_outcomes"];
      const transaction = database.transaction(names, "readonly");
      const values = await Promise.all(
        names.map(
          (name) =>
            new Promise<number>((resolveCount, reject) => {
              const request = transaction.objectStore(name).count();
              request.addEventListener("success", () => resolveCount(request.result), {
                once: true,
              });
              request.addEventListener("error", () => reject(request.error), {
                once: true,
              });
            }),
        ),
      );
      database.close();
      return values;
    });
    expect(counts).toEqual([0, 1, 0, 0]);
  } finally {
    await context.close();
  }
});
