import { browser } from "wxt/browser";
import type { ScreenshotPlan, ScreenshotTile } from "../../src/hosts/chrome/screenshot";

const SCREENSHOT_WEBP_QUALITY = 0.72;
const THUMBNAIL_WEBP_QUALITY = 0.78;

interface SerializedTile {
  readonly geometry: ScreenshotTile;
  readonly imageBase64: string;
}

interface StitchRequest {
  readonly type: "awsm:stitch-screenshot";
  readonly plan: ScreenshotPlan;
  readonly tiles: readonly SerializedTile[];
}

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

function isStitchRequest(value: unknown): value is StitchRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "awsm:stitch-screenshot"
  );
}

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

async function blobBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function stitch(
  request: StitchRequest,
): Promise<{ readonly webpBase64: string; readonly thumbnailBase64: string }> {
  const canvas = new OffscreenCanvas(request.plan.outputWidth, request.plan.outputHeight);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A 2D canvas is unavailable.");
  for (const tile of request.tiles) {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(base64ToBytes(tile.imageBase64)).buffer], { type: "image/png" }),
    );
    try {
      const geometry = tile.geometry;
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
    }
  }
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: SCREENSHOT_WEBP_QUALITY });
  const thumbnail = await thumbnailBlob(canvas, canvas.width, canvas.height);
  return { webpBase64: await blobBase64(blob), thumbnailBase64: await blobBase64(thumbnail) };
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const operation = isStitchRequest(message)
    ? stitch(message)
    : isExportDownloadRequest(message)
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
