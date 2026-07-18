import { describe, expect, it, vi } from "vitest";
import {
  acquireMandatoryMhtml,
  type CaptureHost,
  CaptureHostError,
  preflightCapture,
} from "../../src/hosts/chrome/capture";

function host(overrides: Partial<CaptureHost> = {}): CaptureHost {
  return {
    getActiveTab: vi.fn(async () => ({ id: 7, url: "https://example.test/page" })),
    hasCapturePermission: vi.fn(async () => true),
    isMhtmlAvailable: () => true,
    saveAsMhtml: vi.fn(async () => new Blob(["MIME-Version: 1.0\r\n"])),
    ...overrides,
  };
}

describe("Chrome capture Host preflight", () => {
  it.each([
    "chrome://settings",
    "chrome-extension://id/page",
    "file:///tmp/a",
    "view-source:https://x.test",
  ])("rejects restricted URL %s before MHTML capture", async (url) => {
    const fake = host({ getActiveTab: vi.fn(async () => ({ id: 7, url })) });
    await expect(preflightCapture(fake, true)).rejects.toMatchObject({ id: "UNSUPPORTED_URL" });
    expect(fake.saveAsMhtml).not.toHaveBeenCalled();
  });

  it("accepts active HTTP and HTTPS tabs", async () => {
    await expect(preflightCapture(host(), true)).resolves.toEqual({
      tabId: 7,
      url: "https://example.test/page",
    });
    await expect(
      preflightCapture(
        host({ getActiveTab: vi.fn(async () => ({ id: 8, url: "http://localhost/" })) }),
        true,
      ),
    ).resolves.toEqual({ tabId: 8, url: "http://localhost/" });
  });

  it("rejects a locked Vault, missing tab ID, denied permission, and missing API with typed errors", async () => {
    await expect(preflightCapture(host(), false)).rejects.toMatchObject({ id: "VAULT_LOCKED" });
    await expect(
      preflightCapture(
        host({ getActiveTab: vi.fn(async () => ({ url: "https://example.test" })) }),
        true,
      ),
    ).rejects.toMatchObject({ id: "UNSUPPORTED_URL" });
    await expect(
      preflightCapture(host({ hasCapturePermission: vi.fn(async () => false) }), true),
    ).rejects.toMatchObject({ id: "PERMISSION_DENIED" });
    await expect(
      preflightCapture(host({ isMhtmlAvailable: () => false }), true),
    ).rejects.toMatchObject({ id: "MHTML_UNAVAILABLE" });
  });
});

describe("mandatory MHTML acquisition", () => {
  it("returns non-empty Blob bytes", async () => {
    await expect(acquireMandatoryMhtml(host(), 7)).resolves.toEqual(
      new TextEncoder().encode("MIME-Version: 1.0\r\n"),
    );
  });

  it("maps empty, rejected, and unreadable Blobs to MHTML_CAPTURE_FAILED", async () => {
    const cases: CaptureHost[] = [
      host({ saveAsMhtml: vi.fn(async () => new Blob()) }),
      host({ saveAsMhtml: vi.fn(async () => Promise.reject(new Error("sensitive URL"))) }),
      host({
        saveAsMhtml: vi.fn(
          async () => ({ arrayBuffer: async () => Promise.reject(new Error("bad")) }) as Blob,
        ),
      }),
    ];
    for (const fake of cases) {
      await expect(acquireMandatoryMhtml(fake, 7)).rejects.toMatchObject({
        id: "MHTML_CAPTURE_FAILED",
        message: expect.not.stringContaining("sensitive URL"),
      });
    }
  });

  it("uses a stable typed Host error", () => {
    expect(new CaptureHostError("MHTML_UNAVAILABLE", "Unavailable")).toMatchObject({
      name: "CaptureHostError",
      id: "MHTML_UNAVAILABLE",
    });
  });
});
