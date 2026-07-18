import { browser } from "wxt/browser";
import {
  type PreparedVaultExport,
  type ValidatedVaultPackage,
  validateVaultPackage,
  writeVaultPackage,
} from "../../runtime/export";

const TEMP_DIRECTORY = "awsm-vault-exports";

async function exportDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
}

function temporaryName(packageId: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(packageId)) throw new Error("Invalid Export package identifier.");
  return `${packageId}.awsm.tmp`;
}

export class ChromeVaultExportHost {
  async writeAndValidate(
    packageId: string,
    prepared: PreparedVaultExport,
    passphrase: string,
    signal: AbortSignal,
  ): Promise<ValidatedVaultPackage> {
    const directory = await exportDirectory();
    const file = await directory.getFileHandle(temporaryName(packageId), { create: true });
    const writable = await file.createWritable({ keepExistingData: false });
    try {
      await writeVaultPackage(writable, prepared.entries, signal);
      signal.throwIfAborted();
      await prepared.assertSnapshotCurrent();
      return await validateVaultPackage(await file.getFile(), passphrase);
    } catch (error) {
      await writable.abort().catch(() => undefined);
      if (error instanceof Error && "id" in error) throw error;
      throw Object.assign(new Error("Temporary Export output failed."), {
        id: "EXPORT_DOWNLOAD_FAILED",
      });
    }
  }

  async download(packageId: string, filename: string, signal: AbortSignal): Promise<void> {
    const contexts = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    const createdDocument = contexts.length === 0;
    if (createdDocument) {
      await browser.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Download a validated encrypted Vault Package from temporary storage.",
      });
    }
    const name = temporaryName(packageId);
    const cancel = (): void => {
      void browser.runtime
        .sendMessage({
          type: "awsm:cancel-vault-export-download",
          temporaryName: name,
        })
        .catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (signal.aborted) cancel();
      const response: unknown = await browser.runtime.sendMessage({
        type: "awsm:download-vault-export",
        temporaryName: name,
        filename,
      });
      signal.throwIfAborted();
      if (response !== true)
        throw Object.assign(new Error("Export download failed."), {
          id: "EXPORT_DOWNLOAD_FAILED",
        });
    } finally {
      signal.removeEventListener("abort", cancel);
      if (createdDocument) await browser.offscreen.closeDocument().catch(() => undefined);
    }
  }

  async cleanup(packageId: string): Promise<void> {
    const directory = await exportDirectory();
    await directory.removeEntry(temporaryName(packageId)).catch(() => undefined);
  }
}
