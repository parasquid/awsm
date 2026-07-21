import { type Browser, browser } from "wxt/browser";
import { base64ToBytes, bytesToBase64 } from "../../app/base64";
import type { CaptureMetadataV1 } from "../../domain/artifact-graph";
import type { CapturePageCommandV1 } from "../../domain/contracts";
import type { StructuredBlockV1 } from "../../domain/structured-content";
import type { CaptureHost } from "./capture";
import type {
  CapturedTile,
  PageDimensions,
  ScreenshotHost,
  ScreenshotPlan,
  ScreenshotTile,
} from "./screenshot";

interface MeasuredPage extends PageDimensions {
  readonly scrollX: number;
  readonly scrollY: number;
}

interface PageMetadata {
  readonly finalUrl: string;
  readonly title: string;
  readonly contentType: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

function firstResult<T>(results: readonly Browser.scripting.InjectionResult<T>[]): T {
  const result = results[0]?.result;
  if (result === undefined) throw new Error("The active page did not return capture metadata.");
  return result;
}

export class ChromeCaptureHost implements CaptureHost {
  async getActiveTab(): Promise<{ readonly id?: number; readonly url?: string } | undefined> {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab === undefined
      ? undefined
      : {
          ...(tab.id === undefined ? {} : { id: tab.id }),
          ...(tab.url === undefined ? {} : { url: tab.url }),
        };
  }

  async getTab(tabId: number): Promise<{ readonly id?: number; readonly url?: string }> {
    const tab = await browser.tabs.get(tabId);
    return {
      ...(tab.id === undefined ? {} : { id: tab.id }),
      ...(tab.url === undefined ? {} : { url: tab.url }),
    };
  }

  hasCapturePermission(): Promise<boolean> {
    return browser.permissions.contains({ permissions: ["pageCapture"] });
  }

  isMhtmlAvailable(): boolean {
    return typeof browser.pageCapture?.saveAsMHTML === "function";
  }

  async saveAsMhtml(tabId: number): Promise<Blob> {
    const chromeApi = (
      globalThis as unknown as {
        chrome: {
          runtime: { lastError?: { readonly message?: string } };
          pageCapture: {
            saveAsMHTML(value: { readonly tabId: number }, callback: (blob?: Blob) => void): void;
          };
        };
      }
    ).chrome;
    return new Promise<Blob>((resolve, reject) => {
      chromeApi.pageCapture.saveAsMHTML({ tabId }, (blob) => {
        if (chromeApi.runtime.lastError !== undefined || blob === undefined) {
          reject(new Error("Chrome MHTML capture failed."));
          return;
        }
        resolve(blob);
      });
    });
  }

  async collectMetadata(
    tabId: number,
    command: CapturePageCommandV1,
    capturedAt: string,
    clientVersion: string,
  ): Promise<CaptureMetadataV1> {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: (): PageMetadata => {
        const root = document.documentElement;
        const body = document.body;
        return {
          finalUrl: location.href,
          title: document.title || location.hostname,
          contentType: document.contentType || "text/html",
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0),
          documentHeight: Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0),
        };
      },
    });
    const page = firstResult(results);
    return {
      version: 1,
      originalUrl: command.observedUrl,
      finalUrl: page.finalUrl,
      title: page.title,
      capturedAt,
      contentType: page.contentType,
      viewport: { width: page.viewportWidth, height: page.viewportHeight },
      document: { width: page.documentWidth, height: page.documentHeight },
      chromeVersion: navigator.userAgent.match(/Chrome\/([^ ]+)/u)?.[1] ?? "unknown",
      extensionVersion: clientVersion,
      captureProfileId: "ChromeWebPage-v1",
      captureProfileVersion: 1,
    };
  }

  async collectStructuredContent(tabId: number): Promise<readonly StructuredBlockV1[]> {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: (): StructuredBlockV1[] => {
        const blocks: StructuredBlockV1[] = [];
        let approximateBytes = 0;
        let blockIndex = 0;
        const links = (candidate: HTMLElement) =>
          [...candidate.querySelectorAll<HTMLAnchorElement>("a[href]")].flatMap((anchor) => {
            const url = new URL(anchor.href);
            return url.protocol === "http:" || url.protocol === "https:"
              ? [
                  {
                    text: (anchor.innerText || anchor.textContent || "").trim(),
                    href: url.href,
                  },
                ]
              : [];
          });
        const append = (block: StructuredBlockV1): void => {
          approximateBytes += JSON.stringify(block).length * 2;
          if (approximateBytes > 8 * 1024 * 1024)
            throw new Error("Structured content exceeds its capture bound.");
          blocks.push(block);
        };
        const candidates = document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,table");
        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement)) continue;
          if (
            candidate.closest("[hidden],[aria-hidden='true']") !== null ||
            !candidate.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          )
            continue;
          const text = (candidate.innerText || candidate.textContent || "").trim();
          if (text.length === 0) continue;
          blockIndex += 1;
          const blockId = `B${String(blockIndex).padStart(6, "0")}`;
          const tag = candidate.tagName.toLowerCase();
          if (/^h[1-6]$/u.test(tag)) {
            append({
              blockVersion: 1,
              blockId,
              kind: "Heading",
              level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
              text,
              links: links(candidate),
            });
          } else if (tag === "blockquote") {
            append({
              blockVersion: 1,
              blockId,
              kind: "Quote",
              text,
              links: links(candidate),
            });
          } else if (tag === "li") {
            let depth = 0;
            for (
              let parent = candidate.parentElement?.closest("li");
              parent !== null && parent !== undefined;
              parent = parent.parentElement?.closest("li")
            )
              depth += 1;
            append({
              blockVersion: 1,
              blockId,
              kind: "ListItem",
              ordered: candidate.parentElement?.tagName.toLowerCase() === "ol",
              depth,
              text,
              links: links(candidate),
            });
          } else if (tag === "pre") {
            append({ blockVersion: 1, blockId, kind: "Preformatted", text });
          } else if (tag === "table") {
            const rows = [...candidate.querySelectorAll("tr")]
              .map((row) =>
                [...row.querySelectorAll("th,td")].map((cell) => (cell.textContent ?? "").trim()),
              )
              .filter((row) => row.length > 0);
            if (rows.length > 0) append({ blockVersion: 1, blockId, kind: "Table", rows });
          } else {
            append({
              blockVersion: 1,
              blockId,
              kind: "Paragraph",
              text,
              links: links(candidate),
            });
          }
        }
        return blocks;
      },
    });
    return firstResult(results);
  }
}

export class ChromeScreenshotHost implements ScreenshotHost {
  private originalScroll = { x: 0, y: 0 };
  readonly tabId: number;
  readonly windowId: number;

  private constructor(tabId: number, windowId: number) {
    this.tabId = tabId;
    this.windowId = windowId;
  }

  static async create(tabId: number): Promise<ChromeScreenshotHost> {
    const tab = await browser.tabs.get(tabId);
    if (tab.windowId === undefined) throw new Error("The capture tab has no window.");
    return new ChromeScreenshotHost(tabId, tab.windowId);
  }

  async measure(): Promise<PageDimensions> {
    const results = await browser.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (): MeasuredPage => {
        const root = document.documentElement;
        const body = document.body;
        return {
          documentWidth: Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0),
          documentHeight: Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        };
      },
    });
    const measured = firstResult(results);
    this.originalScroll = { x: measured.scrollX, y: measured.scrollY };
    return measured;
  }

  async prepareTile(tile: ScreenshotTile, hideRepeatedFixedElements: boolean): Promise<void> {
    await browser.scripting.executeScript({
      target: { tabId: this.tabId },
      args: [tile.scrollX, tile.scrollY, hideRepeatedFixedElements],
      func: async (x: number, y: number, hideFixed: boolean): Promise<void> => {
        const marker = "data-awsm-capture-hidden-v1";
        const original = "data-awsm-capture-visibility-v1";
        for (const element of document.querySelectorAll<HTMLElement>(`[${marker}]`)) {
          element.style.visibility = element.getAttribute(original) ?? "";
          element.removeAttribute(marker);
          element.removeAttribute(original);
        }
        window.scrollTo(x, y);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (hideFixed) {
          for (const element of document.querySelectorAll<HTMLElement>("body *")) {
            const position = getComputedStyle(element).position;
            if (position === "fixed" || position === "sticky") {
              element.setAttribute(original, element.style.visibility);
              element.setAttribute(marker, "");
              element.style.visibility = "hidden";
            }
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      },
    });
  }

  async captureVisible(): Promise<Uint8Array> {
    const dataUrl = await browser.tabs.captureVisibleTab(this.windowId, {
      format: "png",
    });
    return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
  }

  async stitch(
    plan: ScreenshotPlan,
    tiles: readonly CapturedTile[],
  ): Promise<import("./screenshot").StitchedScreenshot> {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length === 0) {
      await browser.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Stitch screenshot tiles and encode lossy WebP previews.",
      });
    }
    const port = browser.runtime.connect({
      name: `awsm:screenshot:${crypto.randomUUID()}`,
    });
    let requestSequence = 0;
    const send = (message: Record<string, unknown>): Promise<void> => {
      requestSequence += 1;
      const sequence = requestSequence;
      return new Promise((resolve, reject) => {
        const disconnected = (): void => reject(new Error("Screenshot stitcher disconnected."));
        const acknowledged = (value: unknown): void => {
          if (
            typeof value === "object" &&
            value !== null &&
            "acknowledged" in value &&
            value.acknowledged === sequence
          ) {
            port.onMessage.removeListener(acknowledged);
            port.onDisconnect.removeListener(disconnected);
            resolve();
          }
        };
        port.onMessage.addListener(acknowledged);
        port.onDisconnect.addListener(disconnected);
        port.postMessage({ ...message, sequence });
      });
    };
    const outputParts = new Map<"Full" | "Thumbnail", ArrayBuffer[]>([
      ["Full", []],
      ["Thumbnail", []],
    ]);
    const completed = new Promise<void>((resolve, reject) => {
      port.onMessage.addListener((value: unknown) => {
        if (typeof value !== "object" || value === null || !("outputId" in value)) return;
        const outputId = value.outputId;
        if (typeof outputId !== "number") return;
        if ("kind" in value && (value.kind === "Full" || value.kind === "Thumbnail")) {
          if ("chunkBase64" in value && typeof value.chunkBase64 === "string") {
            outputParts
              .get(value.kind)
              ?.push(Uint8Array.from(base64ToBytes(value.chunkBase64)).buffer);
          }
          port.postMessage({ outputAcknowledged: outputId });
          return;
        }
        if ("done" in value && value.done === true) {
          port.postMessage({ outputAcknowledged: outputId });
          resolve();
        }
      });
      port.onDisconnect.addListener(() => reject(new Error("Screenshot output was interrupted.")));
    });
    try {
      await send({ operation: "Start", plan });
      const chunkBytes = 192 * 1024;
      for (const tile of tiles) {
        await send({ operation: "TileStart", geometry: tile.geometry });
        for (let offset = 0; offset < tile.imageBytes.byteLength; offset += chunkBytes) {
          await send({
            operation: "TileChunk",
            chunkBase64: bytesToBase64(
              tile.imageBytes.subarray(
                offset,
                Math.min(offset + chunkBytes, tile.imageBytes.byteLength),
              ),
            ),
          });
        }
        await send({ operation: "TileEnd" });
      }
      await send({ operation: "Finish" });
      await completed;
      return {
        webpBlob: new Blob(outputParts.get("Full"), { type: "image/webp" }),
        thumbnailWebpBlob: new Blob(outputParts.get("Thumbnail"), {
          type: "image/webp",
        }),
      };
    } finally {
      port.disconnect();
      await browser.offscreen.closeDocument();
    }
  }

  async restore(): Promise<void> {
    await browser.scripting.executeScript({
      target: { tabId: this.tabId },
      args: [this.originalScroll.x, this.originalScroll.y],
      func: (x: number, y: number): void => {
        const marker = "data-awsm-capture-hidden-v1";
        const original = "data-awsm-capture-visibility-v1";
        for (const element of document.querySelectorAll<HTMLElement>(`[${marker}]`)) {
          element.style.visibility = element.getAttribute(original) ?? "";
          element.removeAttribute(marker);
          element.removeAttribute(original);
        }
        window.scrollTo(x, y);
      },
    });
  }

  now(): number {
    return Date.now();
  }

  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
