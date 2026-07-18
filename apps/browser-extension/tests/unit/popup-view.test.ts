import { describe, expect, it } from "vitest";
import type { AppStateV1 } from "../../src/app/protocol";
import { popupView } from "../../src/ui/popup-view";

const base: AppStateV1 = {
  version: 1,
  vaultExists: true,
  unlocked: true,
  hasPassphraseSlot: false,
};

describe("popup state model", () => {
  it("shows onboarding before a Vault exists", () => {
    expect(popupView({ ...base, vaultExists: false, unlocked: false })).toEqual({
      screen: "onboarding",
    });
  });

  it("shows both available unlock methods", () => {
    expect(popupView({ ...base, unlocked: false, hasPassphraseSlot: true })).toEqual({
      screen: "locked",
      passphraseAvailable: true,
    });
  });

  it("shows persisted background capture progress", () => {
    expect(
      popupView({
        ...base,
        latestJob: {
          version: 1,
          jobId: "00000000-0000-4000-8000-000000000001",
          commandId: "00000000-0000-4000-8000-000000000002",
          tabId: 7,
          state: "Running",
          stage: "Screenshot",
          createdAt: "2026-07-16T17:00:00.000Z",
          updatedAt: "2026-07-16T17:00:01.000Z",
        },
      }),
    ).toEqual({ screen: "capturing", stage: "Screenshot" });
  });

  it("shows success and typed failure without depending on message text", () => {
    expect(
      popupView({
        ...base,
        latestJob: {
          version: 1,
          jobId: "00000000-0000-4000-8000-000000000001",
          commandId: "00000000-0000-4000-8000-000000000002",
          tabId: 7,
          state: "Succeeded",
          stage: "Commit",
          createdAt: "2026-07-16T17:00:00.000Z",
          updatedAt: "2026-07-16T17:00:01.000Z",
        },
      }),
    ).toEqual({ screen: "ready", notice: "capture-succeeded" });
    expect(
      popupView({
        ...base,
        latestJob: {
          version: 1,
          jobId: "00000000-0000-4000-8000-000000000001",
          commandId: "00000000-0000-4000-8000-000000000002",
          tabId: 7,
          state: "Failed",
          stage: "MHTML",
          errorId: "MHTML_CAPTURE_FAILED",
          createdAt: "2026-07-16T17:00:00.000Z",
          updatedAt: "2026-07-16T17:00:01.000Z",
        },
      }),
    ).toEqual({ screen: "ready", notice: "MHTML_CAPTURE_FAILED" });
  });

  it("shows a visible warning when the committed capture lacks its screenshot", () => {
    expect(
      popupView({
        ...base,
        latestWarnings: ["SCREENSHOT_CAPTURE_FAILED"],
        latestJob: {
          version: 1,
          jobId: "00000000-0000-4000-8000-000000000001",
          commandId: "00000000-0000-4000-8000-000000000002",
          tabId: 7,
          state: "Succeeded",
          stage: "Commit",
          createdAt: "2026-07-16T17:00:00.000Z",
          updatedAt: "2026-07-16T17:00:01.000Z",
        },
      }),
    ).toEqual({ screen: "ready", notice: "screenshot-warning" });
  });

  it("identifies the latest capture in a dismissible card with a thumbnail", () => {
    const state = {
      ...base,
      recentCapture: {
        jobId: "00000000-0000-4000-8000-000000000001",
        bundleId: "00000000-0000-4000-8000-000000000002",
        title: "A page worth keeping",
        screenshotBase64: "iVBORw0KGgo=",
        warnings: [],
      },
    } as AppStateV1;

    expect(popupView(state)).toEqual({
      screen: "ready",
      recentCapture: state.recentCapture,
    });
  });

  it("shows no stale success message after the recent capture is dismissed", () => {
    expect(
      popupView({
        ...base,
        latestJob: {
          version: 1,
          jobId: "00000000-0000-4000-8000-000000000001",
          commandId: "00000000-0000-4000-8000-000000000002",
          tabId: 7,
          state: "Succeeded",
          stage: "Commit",
          createdAt: "2026-07-16T17:00:00.000Z",
          updatedAt: "2026-07-16T17:00:01.000Z",
          noticeDismissed: true,
        },
      }),
    ).toEqual({ screen: "ready" });
  });
});
