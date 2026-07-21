const MHTML_MEDIA_TYPE = "multipart/related";

export function mhtmlDownloadBlob(source: Blob): Blob {
  return new Blob([source], { type: MHTML_MEDIA_TYPE });
}

export function mhtmlDownloadFilenameSuggestion(
  downloadUrl: string,
  expectedUrl: string,
  filename: string,
): { readonly filename: string; readonly conflictAction: "uniquify" } | undefined {
  return downloadUrl === expectedUrl ? { filename, conflictAction: "uniquify" } : undefined;
}
