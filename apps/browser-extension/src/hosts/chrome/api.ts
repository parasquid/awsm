import { type Browser, browser } from "wxt/browser";
import { base64ToBytes, bytesToBase64 } from "../../app/base64";
import type { CaptureMetadataV1 } from "../../domain/bundle";
import type { CapturePageCommandV1 } from "../../domain/contracts";
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
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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
    const captured = await new Promise<Uint8Array>((resolve, reject) => {
      chromeApi.pageCapture.saveAsMHTML({ tabId }, (blob) => {
        if (chromeApi.runtime.lastError !== undefined || blob === undefined) {
          reject(new Error("Chrome MHTML capture failed."));
          return;
        }
        void blob.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new Error("Chrome MHTML Blob could not be read.")),
        );
      });
    });
    return new Blob([Uint8Array.from(captured).buffer], { type: "multipart/related" });
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
    const dataUrl = await browser.tabs.captureVisibleTab(this.windowId, { format: "png" });
    return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
  }

  async stitch(
    plan: ScreenshotPlan,
    tiles: readonly CapturedTile[],
  ): Promise<import("./screenshot").StitchedScreenshot> {
    const contexts = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (contexts.length === 0) {
      await browser.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Stitch screenshot tiles and encode lossy WebP previews.",
      });
    }
    try {
      const response: unknown = await browser.runtime.sendMessage({
        type: "awsm:stitch-screenshot",
        plan,
        tiles: tiles.map((tile) => ({
          geometry: tile.geometry,
          imageBase64: bytesToBase64(tile.imageBytes),
        })),
      });
      if (
        typeof response !== "object" ||
        response === null ||
        !("webpBase64" in response) ||
        typeof response.webpBase64 !== "string" ||
        !("thumbnailBase64" in response) ||
        typeof response.thumbnailBase64 !== "string"
      ) {
        throw new Error("The offscreen stitcher returned an invalid result.");
      }
      return {
        webpBytes: base64ToBytes(response.webpBase64),
        thumbnailWebpBytes: base64ToBytes(response.thumbnailBase64),
      };
    } finally {
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
