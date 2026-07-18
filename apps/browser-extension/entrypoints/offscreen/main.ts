import { type Browser, browser } from "wxt/browser";
import type { ScreenshotPlan, ScreenshotTile } from "../../src/hosts/chrome/screenshot";

const SCREENSHOT_WEBP_QUALITY = 0.72;
const THUMBNAIL_WEBP_QUALITY = 0.78;

interface ExportDownloadRequest {
  readonly type: "awsm:download-vault-export";
  readonly temporaryName: string;
  readonly filename: string;
}

interface CancelExportDownloadRequest {
  readonly type: "awsm:cancel-vault-export-download";
  readonly temporaryName: string;
}

const activeExportDownloads = new Map<string, number>();

function isExportDownloadRequest(value: unknown): value is ExportDownloadRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "awsm:download-vault-export" &&
    "temporaryName" in value &&
    typeof value.temporaryName === "string" &&
    "filename" in value &&
    typeof value.filename === "string"
  );
}

async function downloadExport(request: ExportDownloadRequest): Promise<true> {
  if (!/^[0-9a-f-]{36}\.awsm\.tmp$/iu.test(request.temporaryName))
    throw new Error("Invalid temporary Export name.");
  if (!/^awsm-vault-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.awsm$/iu.test(request.filename)) {
    throw new Error("Invalid Export filename.");
  }
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("awsm-vault-exports");
  const handle = await directory.getFileHandle(request.temporaryName);
  const url = URL.createObjectURL(await handle.getFile());
  try {
    const downloadId = await browser.downloads.download({
      url,
      filename: request.filename,
      saveAs: true,
    });
    activeExportDownloads.set(request.temporaryName, downloadId);
    await new Promise<void>((resolve, reject) => {
      const listener: Parameters<typeof browser.downloads.onChanged.addListener>[0] = (
        delta,
      ): void => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === "complete") {
          browser.downloads.onChanged.removeListener(listener);
          resolve();
        } else if (delta.state?.current === "interrupted" || delta.error?.current !== undefined) {
          browser.downloads.onChanged.removeListener(listener);
          reject(new Error("Vault Package download was interrupted."));
        }
      };
      browser.downloads.onChanged.addListener(listener);
    });
    return true;
  } finally {
    activeExportDownloads.delete(request.temporaryName);
    URL.revokeObjectURL(url);
  }
}

async function cancelExportDownload(request: CancelExportDownloadRequest): Promise<true> {
  const downloadId = activeExportDownloads.get(request.temporaryName);
  if (downloadId !== undefined) await browser.downloads.cancel(downloadId);
  return true;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

async function thumbnailBlob(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob> {
  const width = 640;
  const height = 360;
  const targetRatio = width / height;
  const sourceRatio = sourceWidth / sourceHeight;
  const cropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth;
  const cropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio;
  const sourceX = Math.max(0, (sourceWidth - cropWidth) / 2);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A thumbnail canvas is unavailable.");
  context.drawImage(source, sourceX, 0, cropWidth, cropHeight, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/webp", quality: THUMBNAIL_WEBP_QUALITY });
}

function attachScreenshotPort(port: Browser.runtime.Port): void {
  if (!port.name.startsWith("awsm:screenshot:")) return;
  let canvas: OffscreenCanvas | undefined;
  let context: OffscreenCanvasRenderingContext2D | undefined;
  let geometry: ScreenshotTile | undefined;
  let tileParts: ArrayBuffer[] = [];
  let outputSequence = 0;
  let queue = Promise.resolve();
  const sendOutput = (value: Record<string, unknown>): Promise<void> => {
    outputSequence += 1;
    const outputId = outputSequence;
    return new Promise((resolve, reject) => {
      const disconnected = (): void => reject(new Error("Screenshot consumer disconnected."));
      const acknowledged = (message: unknown): void => {
        if (
          typeof message === "object" &&
          message !== null &&
          "outputAcknowledged" in message &&
          message.outputAcknowledged === outputId
        ) {
          port.onMessage.removeListener(acknowledged);
          port.onDisconnect.removeListener(disconnected);
          resolve();
        }
      };
      port.onMessage.addListener(acknowledged);
      port.onDisconnect.addListener(disconnected);
      port.postMessage({ ...value, outputId });
    });
  };
  const streamBlob = async (kind: "Full" | "Thumbnail", blob: Blob): Promise<void> => {
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        await sendOutput({ kind, chunkBase64: bytesToBase64(next.value) });
      }
    } finally {
      reader.releaseLock();
    }
  };
  port.onMessage.addListener((message: unknown) => {
    queue = queue.then(async () => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("operation" in message) ||
        !("sequence" in message) ||
        typeof message.sequence !== "number"
      )
        throw new Error("Invalid screenshot operation.");
      if (message.operation === "Start" && "plan" in message) {
        const plan = message.plan as ScreenshotPlan;
        canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
        context = canvas.getContext("2d") ?? undefined;
        if (context === undefined) throw new Error("A 2D canvas is unavailable.");
      } else if (message.operation === "TileStart" && "geometry" in message) {
        geometry = message.geometry as ScreenshotTile;
        tileParts = [];
      } else if (
        message.operation === "TileChunk" &&
        "chunkBase64" in message &&
        typeof message.chunkBase64 === "string"
      ) {
        tileParts.push(Uint8Array.from(base64ToBytes(message.chunkBase64)).buffer);
      } else if (message.operation === "TileEnd") {
        if (context === undefined || geometry === undefined) throw new Error("Tile state missing.");
        const bitmap = await createImageBitmap(new Blob(tileParts, { type: "image/png" }));
        try {
          context.drawImage(
            bitmap,
            geometry.sourcePixelX,
            geometry.sourcePixelY,
            geometry.pixelWidth,
            geometry.pixelHeight,
            geometry.pixelX,
            geometry.pixelY,
            geometry.pixelWidth,
            geometry.pixelHeight,
          );
        } finally {
          bitmap.close();
          tileParts = [];
          geometry = undefined;
        }
      } else if (message.operation === "Finish") {
        if (canvas === undefined) throw new Error("Screenshot canvas missing.");
        const full = await canvas.convertToBlob({
          type: "image/webp",
          quality: SCREENSHOT_WEBP_QUALITY,
        });
        const thumbnail = await thumbnailBlob(canvas, canvas.width, canvas.height);
        await streamBlob("Full", full);
        await streamBlob("Thumbnail", thumbnail);
        await sendOutput({ done: true });
      } else throw new Error("Unsupported screenshot operation.");
      port.postMessage({ acknowledged: message.sequence });
    });
    void queue.catch(() => port.disconnect());
  });
}

browser.runtime.onConnect.addListener(attachScreenshotPort);

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const operation = isExportDownloadRequest(message)
    ? downloadExport(message)
    : typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "awsm:cancel-vault-export-download" &&
        "temporaryName" in message &&
        typeof message.temporaryName === "string"
      ? cancelExportDownload(message as CancelExportDownloadRequest)
      : undefined;
  if (operation === undefined) return false;
  void operation.then(sendResponse, () => sendResponse(undefined));
  return true;
});
