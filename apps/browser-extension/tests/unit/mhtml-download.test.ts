import { describe, expect, it } from "vitest";
import {
  mhtmlDownloadBlob,
  mhtmlDownloadFilenameSuggestion,
} from "../../src/hosts/chrome/mhtml-download";

describe("MHTML download Blob", () => {
  it("preserves the archive bytes and declares the MHTML media type", async () => {
    const archive = "MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n";
    const temporaryFile = new Blob([archive]);

    const download = mhtmlDownloadBlob(temporaryFile);

    expect(download.type).toBe("multipart/related");
    expect(await download.text()).toBe(archive);
  });
});

describe("MHTML download filename", () => {
  it("overrides Chrome's MIME-derived name only for the prepared archive URL", () => {
    expect(
      mhtmlDownloadFilenameSuggestion("blob:prepared", "blob:prepared", "awsm-capture.mhtml"),
    ).toEqual({ filename: "awsm-capture.mhtml", conflictAction: "uniquify" });
    expect(
      mhtmlDownloadFilenameSuggestion("blob:other", "blob:prepared", "awsm-capture.mhtml"),
    ).toBeUndefined();
  });
});
