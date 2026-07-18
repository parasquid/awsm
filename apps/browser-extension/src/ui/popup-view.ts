import type { AppStateV1, RecentCaptureV1 } from "../app/protocol";
import type { RuntimeErrorId } from "../domain/contracts";

export type PopupView =
  | { readonly screen: "onboarding" }
  | { readonly screen: "locked"; readonly passphraseAvailable: boolean }
  | { readonly screen: "capturing"; readonly stage: string }
  | {
      readonly screen: "ready";
      readonly notice?: "capture-succeeded" | "screenshot-warning" | RuntimeErrorId;
      readonly recentCapture?: RecentCaptureV1;
    };

export function popupView(state: AppStateV1): PopupView {
  if (!state.vaultExists) return { screen: "onboarding" };
  if (!state.unlocked) {
    return { screen: "locked", passphraseAvailable: state.hasPassphraseSlot };
  }
  if (state.latestJob?.state === "Running" || state.latestJob?.state === "Created") {
    return { screen: "capturing", stage: state.latestJob.stage };
  }
  if (state.latestJob?.state === "Failed") {
    return {
      screen: "ready",
      ...(state.latestJob.errorId === undefined ? {} : { notice: state.latestJob.errorId }),
    };
  }
  if (state.recentCapture !== undefined) {
    return { screen: "ready", recentCapture: state.recentCapture };
  }
  if (state.latestJob?.state === "Succeeded") {
    if (state.latestJob.noticeDismissed === true) return { screen: "ready" };
    return {
      screen: "ready",
      notice:
        state.latestWarnings !== undefined && state.latestWarnings.length > 0
          ? "screenshot-warning"
          : "capture-succeeded",
    };
  }
  return { screen: "ready" };
}
