import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";

async function extensionPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

test("captures MHTML and a full-page screenshot, then opens and downloads them offline", async ({
  browserName,
}, testInfo) => {
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
        globalThis as unknown as { chrome: { action: { openPopup(): Promise<void> } } }
      ).chrome;
      await extensionApi.action.openPopup();
    });
    const popup = await extensionPopup(context, extensionId);
    await popup.locator("body").press("Tab");
    await expect(popup.getByRole("checkbox", { name: /Add a passphrase/u })).toBeFocused();
    await popup.keyboard.press("Tab");
    await expect(popup.getByRole("button", { name: "Create Vault" })).toBeFocused();
    await popup.keyboard.press("Enter");
    await expect(popup.getByRole("button", { name: "Archive this page" })).toBeVisible();
    const stitchProbe = await popup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            offscreen: {
              createDocument(value: unknown): Promise<void>;
              closeDocument(): Promise<void>;
            };
            runtime: { sendMessage(value: unknown): Promise<unknown> };
          };
        }
      ).chrome;
      await extensionApi.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "E2E image stitch probe.",
      });
      try {
        return await extensionApi.runtime.sendMessage({
          type: "awsm:stitch-screenshot:v1",
          plan: { outputWidth: 1, outputHeight: 1, tiles: [] },
          tiles: [],
        });
      } finally {
        await extensionApi.offscreen.closeDocument();
      }
    });
    expect(stitchProbe).toMatchObject({ webpBase64: expect.any(String) });
    await popup.evaluate(async () => {
      const extensionApi = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(value: unknown): Promise<readonly { id?: number; url?: string }[]>;
              update(id: number, value: unknown): Promise<unknown>;
            };
            runtime: { sendMessage(value: unknown, callback: () => void): void };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      extensionApi.runtime.sendMessage(
        { version: 1, type: "CaptureActivePage", tabId: fixtureTab.id },
        () => undefined,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
    await popup.reload();
    const completedPopup = popup;
    await expect(completedPopup.getByText("Archived: AWSM tall fixture")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      completedPopup.getByRole("img", { name: "Screenshot thumbnail for AWSM tall fixture" }),
    ).toBeVisible();
    const capturePreview = completedPopup.getByRole("link", {
      name: "Open archived capture: AWSM tall fixture",
    });
    await expect(capturePreview).toHaveAttribute("href", /library\.html\?bundleId=/u);
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
            runtime: { sendMessage(value: unknown, callback: () => void): void };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      extensionApi.runtime.sendMessage(
        { version: 1, type: "CaptureActivePage", tabId: fixtureTab.id },
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
    const library = await context.newPage();
    await library.goto(`chrome-extension://${extensionId}/library.html`);
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

    const storageAudit = await library.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
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
              request.addEventListener("error", () => reject(request.error), { once: true });
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

    await expect(library.locator("iframe, object, embed")).toHaveCount(0);
    await expect(library.locator("body")).not.toHaveAttribute(
      "data-live-fixture",
      "executed-only-on-live-page",
    );
    const downloadPromise = library.waitForEvent("download");
    await library.getByRole("link", { name: "Download archived MHTML" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toMatch(/\.mhtml$/u);
    expect(downloadPath).not.toBeNull();
    const mhtml = await readFile(downloadPath ?? "", "utf8");
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
    const deletedDownloadPromise = library.waitForEvent("download");
    await library.getByRole("link", { name: "Download archived MHTML" }).click();
    expect((await deletedDownloadPromise).suggestedFilename()).toMatch(/\.mhtml$/u);
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
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
      const transaction = database.transaction("objects", "readonly");
      const count = await new Promise<number>((resolveCount, reject) => {
        const request = transaction.objectStore("objects").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
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
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
      const transaction = database.transaction("objects", "readonly");
      const count = await new Promise<number>((resolveCount, reject) => {
        const request = transaction.objectStore("objects").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
      const generationTransaction = database.transaction(
        ["vault_head", "vault_generations"],
        "readonly",
      );
      const head = await new Promise<Record<string, unknown>>((resolveHead, reject) => {
        const request = generationTransaction.objectStore("vault_head").get("active");
        request.addEventListener("success", () => resolveHead(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
      const generationCount = await new Promise<number>((resolveCount, reject) => {
        const request = generationTransaction.objectStore("vault_generations").count();
        request.addEventListener("success", () => resolveCount(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
      database.close();
      return { objectCount: count, head, generationCount };
    });
    expect(vacuumStorage.objectCount).toBeLessThan(objectsBeforeVacuum);
    expect(vacuumStorage.generationCount).toBe(1);
    expect(vacuumStorage.head).toMatchObject({ version: 1, generationNumber: 1 });
    expect(consoleErrors).toEqual([]);
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
            runtime: { sendMessage(value: unknown, callback: () => void): void };
          };
        }
      ).chrome;
      const tabs = await extensionApi.tabs.query({ currentWindow: true });
      const fixtureTab = tabs.find(
        (tab) => tab.id !== undefined && tab.url === "http://127.0.0.1:4174/fixture",
      );
      if (fixtureTab?.id === undefined) throw new Error("The fixture tab is unavailable.");
      await extensionApi.tabs.update(fixtureTab.id, { active: true });
      extensionApi.runtime.sendMessage(
        { version: 1, type: "CaptureActivePage", tabId: fixtureTab.id },
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
            request.addEventListener("error", () => reject(request.error), { once: true });
          });
          const transaction = database.transaction("capture_jobs", "readonly");
          const jobs = await new Promise<readonly { state?: unknown }[]>((resolveJobs, reject) => {
            const request = transaction.objectStore("capture_jobs").getAll();
            request.addEventListener("success", () => resolveJobs(request.result), { once: true });
            request.addEventListener("error", () => reject(request.error), { once: true });
          });
          database.close();
          return jobs.at(-1)?.state;
        }),
      )
      .toBe("Running");
    await cdp.send("ServiceWorker.stopWorker", { versionId: serviceWorkerVersionId });
    await popup.close();
    const restartedPopup = await extensionPopup(context, extensionId);
    await expect(restartedPopup.getByText(/CAPTURE_INTERRUPTED/u)).toBeVisible({ timeout: 30_000 });
    const counts = await restartedPopup.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open("awsm-vault");
        request.addEventListener("success", () => resolveDatabase(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
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
              request.addEventListener("error", () => reject(request.error), { once: true });
            }),
        ),
      );
      database.close();
      return values;
    });
    expect(counts).toEqual([0, 0, 0, 0]);
  } finally {
    await context.close();
  }
});
