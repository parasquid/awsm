import { describe, expect, it } from "vitest";
import { mhtmlDownloadFilename } from "../../src/hosts/chrome/artifact-download";

describe("MHTML download", () => {
  it("uses a deterministic user-facing MHTML filename", () => {
    expect(mhtmlDownloadFilename("12345678-0000-4000-8000-000000000000")).toBe(
      "awsm-12345678-mhtml.mhtml",
    );
  });
});
