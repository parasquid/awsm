import { browser } from "wxt/browser";
import { AppClientError, sendRequest } from "../../src/app/client";
import type { AppState } from "../../src/app/protocol";
import { popupView } from "../../src/ui/popup-view";
import { vaultManagementView } from "../../src/ui/vault-management-view";

function requiredElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error("Popup shell is incomplete.");
  return node;
}

const app = requiredElement("#app");
const announcer = requiredElement("#announcer");
const popupLifetime = browser.runtime.connect({ name: "awsm:popup-lifetime" });
let visibleRecentCaptureJobId: string | undefined;
let renderedState: AppState | undefined;
let suggestedVaultName: string | undefined;
let captureRequestPending = false;

function expectedVaultId(): string {
  const vaultId = renderedState?.workspace.activeVaultId;
  if (vaultId === undefined) throw new Error("No active Vault is selected.");
  return vaultId;
}

function dismissSeenCapture(jobId: string): Promise<AppState> {
  if (visibleRecentCaptureJobId === jobId) visibleRecentCaptureJobId = undefined;
  popupLifetime.postMessage({ vaultId: expectedVaultId(), jobId: null });
  return sendRequest<AppState>({
    type: "DismissRecentCapture",
    expectedVaultId: expectedVaultId(),
    jobId,
  });
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  text?: string,
  className?: string,
) {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function request(type: "GetState" | "UnlockDevice" | "LockVault"): Promise<AppState> {
  return type === "GetState"
    ? sendRequest<AppState>({ type })
    : sendRequest<AppState>({ type, expectedVaultId: expectedVaultId() });
}

function errorText(error: unknown): string {
  return error instanceof AppClientError ? error.message : "The operation could not be completed.";
}

function heading(subtitle: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(element("p", "AWSM", "eyebrow"), element("h1", subtitle));
  return fragment;
}

function status(
  message: string,
  kind: "info" | "success" | "warning" | "error" = "info",
): HTMLElement {
  const node = element("p", message, `status status--${kind}`);
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  return node;
}

async function regenerateVaultName(input?: HTMLInputElement): Promise<void> {
  const suggestion = await sendRequest<{ readonly name: string }>({ type: "SuggestVaultName" });
  suggestedVaultName = suggestion.name;
  if (input !== undefined) {
    input.value = suggestion.name;
    input.focus();
    input.select();
  }
}

function createVaultForm(state: AppState, secondary: boolean): HTMLFormElement {
  const form = element("form");
  const nameLabel = element("label", "Vault name");
  const name = element("input");
  name.name = "vault-name";
  name.required = true;
  name.maxLength = 64;
  name.value = suggestedVaultName ?? "";
  nameLabel.append(name);
  const regenerate = element("button", "Generate another name");
  regenerate.type = "button";
  regenerate.addEventListener("click", () => {
    regenerate.disabled = true;
    void regenerateVaultName(name).finally(() => {
      regenerate.disabled = false;
    });
  });
  const actions = element("div", undefined, "actions");
  const submit = element("button", "Create Vault", "primary");
  submit.type = "submit";
  actions.append(submit);
  if (secondary) {
    const cancel = element("button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => form.closest("dialog")?.close());
    actions.append(cancel);
  }
  form.append(nameLabel, regenerate, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void sendRequest<AppState>({
      type: "CreateVault",
      name: name.value,
      ...(state.workspace.activeVaultId === undefined
        ? {}
        : { expectedActiveVaultId: state.workspace.activeVaultId }),
    }).then(
      (next) => {
        suggestedVaultName = undefined;
        form.closest("dialog")?.close();
        announcer.textContent = `Created and selected ${name.value}`;
        render(next);
      },
      (cause) => refresh(errorText(cause)),
    );
  });
  return form;
}

function showCreateDialog(state: AppState, restoreFocus: HTMLElement): void {
  const dialog = element("dialog") as HTMLDialogElement;
  const title = element("h2", "Create another Vault");
  title.id = `dialog-title-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.append(title);
  dialog.append(
    element("p", "Creating another Vault locks the current Vault."),
    createVaultForm(state, true),
  );
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      restoreFocus.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  const input = dialog.querySelector<HTMLInputElement>('input[name="vault-name"]');
  if (suggestedVaultName === undefined) void regenerateVaultName(input ?? undefined);
  else input?.select();
}

function vaultControls(state: AppState): HTMLElement | undefined {
  const view = vaultManagementView(state.workspace);
  const managementDisabled = view.managementDisabled || captureRequestPending;
  const active = state.workspace.vaults.find((vault) => vault.active);
  if (active === undefined) return undefined;
  const section = element("section", undefined, "vault-control");
  const summary = element("p");
  summary.append(
    document.createTextNode("Vault · "),
    element("strong", active.name),
    document.createTextNode(` · ${active.unlocked ? "Unlocked" : "Locked"}`),
  );
  section.append(summary);
  if (view.busyText !== undefined) section.append(status(view.busyText));
  else if (captureRequestPending) section.append(status("Capture in progress"));
  const actions = element("div", undefined, "actions");
  const switcher = element("button", "Switch Vault");
  switcher.type = "button";
  switcher.disabled = managementDisabled;
  switcher.addEventListener("click", () => {
    const dialog = element("dialog") as HTMLDialogElement;
    const form = element("form");
    const title = element("h2", "Switch Vault");
    title.id = `dialog-title-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", title.id);
    form.append(title, element("p", "Switching locks the current Vault."));
    let selectedVaultId = active.vaultId;
    for (const option of view.options) {
      const label = element("label", undefined, "picker__option");
      const radio = element("input");
      radio.type = "radio";
      radio.name = "vault";
      radio.value = option.vaultId;
      radio.checked = option.current;
      if (option.current) radio.autofocus = true;
      radio.addEventListener("change", () => {
        selectedVaultId = option.vaultId;
      });
      label.append(
        radio,
        element(
          "span",
          `${option.label}${option.current ? " · Current" : ""} · Created ${option.createdAt.slice(0, 10)}`,
        ),
      );
      form.append(label);
    }
    const dialogActions = element("div", undefined, "actions");
    const choose = element("button", "Switch");
    choose.type = "submit";
    const create = element("button", "Create another Vault");
    create.type = "button";
    let createAfterClose = false;
    create.addEventListener("click", () => {
      createAfterClose = true;
      dialog.close();
    });
    const cancel = element("button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => dialog.close());
    dialogActions.append(choose, create, cancel);
    form.append(dialogActions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      choose.disabled = true;
      void sendRequest<AppState>({
        type: "SelectActiveVault",
        expectedActiveVaultId: active.vaultId,
        vaultId: selectedVaultId,
      }).then(
        (next) => {
          dialog.close();
          announcer.textContent = `Selected ${next.workspace.vaults.find((vault) => vault.active)?.name ?? "Vault"}. Unlock it to continue.`;
          render(next);
        },
        (cause) => {
          dialog.close();
          void refresh(errorText(cause));
        },
      );
    });
    dialog.append(form);
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (createAfterClose) showCreateDialog(state, switcher);
        else switcher.focus();
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
  actions.append(switcher);
  section.append(actions);
  return section;
}

async function refresh(error?: string): Promise<void> {
  try {
    render(await request("GetState"), error);
  } catch (cause) {
    app.replaceChildren(heading("Local archive"), status(errorText(cause), "error"));
    app.setAttribute("aria-busy", "false");
  }
}

function render(state: AppState, transientError?: string): void {
  renderedState = state;
  const view = popupView(state);
  visibleRecentCaptureJobId = view.screen === "ready" ? view.recentCapture?.jobId : undefined;
  popupLifetime.postMessage({
    vaultId: state.workspace.activeVaultId ?? null,
    jobId: visibleRecentCaptureJobId ?? null,
  });
  const content = document.createDocumentFragment();
  content.append(
    heading(view.screen === "onboarding" ? "Create your local Vault" : "Archive this page"),
  );
  const controls = vaultControls(state);
  if (controls !== undefined) content.append(controls);
  if (transientError !== undefined) content.append(status(transientError, "error"));

  if (view.screen === "onboarding") {
    content.append(
      element("p", "Your captures are encrypted locally. No account or server is required."),
    );
    if (suggestedVaultName === undefined) {
      content.append(status("Generating a Vault name…"));
      void regenerateVaultName().then(
        () => render(state),
        (cause) => refresh(errorText(cause)),
      );
    } else content.append(createVaultForm(state, false));
  } else if (view.screen === "locked") {
    content.append(element("p", "Unlock the Vault before capturing or opening the library."));
    const device = element("button", "Unlock on this device", "primary");
    device.addEventListener("click", () => {
      device.disabled = true;
      void request("UnlockDevice").then(
        (next) => render(next),
        (cause) => refresh(errorText(cause)),
      );
    });
    content.append(device);
  } else if (view.screen === "capturing") {
    content.append(status(`Capturing: ${view.stage}…`));
    announcer.textContent = `Capture stage ${view.stage}`;
    window.setTimeout(() => void refresh(), 500);
  } else {
    if (view.recentCapture !== undefined) {
      const recentCapture = view.recentCapture;
      const cardGroup = element("div", undefined, "recent-capture-group");
      const card = element("a", undefined, "recent-capture");
      card.href = `${browser.runtime.getURL("/library.html")}?vaultId=${encodeURIComponent(recentCapture.vaultId)}&bundleId=${encodeURIComponent(recentCapture.bundleId)}`;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", `Open archived capture: ${recentCapture.title}`);
      card.addEventListener("click", (event) => {
        event.preventDefault();
        const open = (): Promise<unknown> => browser.tabs.create({ url: card.href });
        void dismissSeenCapture(recentCapture.jobId).then(open, open);
      });
      const title = element("p", undefined, "recent-capture__title");
      title.append(document.createTextNode("Archived: "), element("strong", recentCapture.title));
      const dismiss = element("button", "×", "recent-capture__dismiss");
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", `Dismiss recent capture: ${recentCapture.title}`);
      dismiss.addEventListener("click", () => {
        dismiss.disabled = true;
        void dismissSeenCapture(recentCapture.jobId).then(
          (next) => render(next),
          (cause) => refresh(errorText(cause)),
        );
      });
      card.append(title);
      if (recentCapture.screenshotBase64 !== undefined) {
        const thumbnail = element("img", undefined, "recent-capture__thumbnail");
        thumbnail.src = `data:image/webp;base64,${recentCapture.screenshotBase64}`;
        thumbnail.alt = `Screenshot thumbnail for ${recentCapture.title}`;
        card.append(thumbnail);
      }
      if (recentCapture.warnings.length > 0) {
        card.append(status("The full-page screenshot was unavailable.", "warning"));
      }
      cardGroup.append(card, dismiss);
      content.append(cardGroup);
    } else if (view.notice === "capture-succeeded") {
      content.append(status("Page archived in your Vault.", "success"));
    } else if (view.notice === "screenshot-warning") {
      content.append(status("Page archived. The full-page screenshot was unavailable.", "warning"));
    } else if (view.notice !== undefined) {
      content.append(status(`Capture failed (${view.notice}). Retry when ready.`, "error"));
    }
    const capture = element("button", "Archive this page", "primary");
    capture.addEventListener("click", () => {
      capture.disabled = true;
      captureRequestPending = true;
      announcer.textContent = "Capture started";
      render(state);
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) =>
          sendRequest<{ readonly bundleId: string }>({
            type: "CaptureActivePage",
            expectedVaultId: expectedVaultId(),
            ...(tab?.id === undefined ? {} : { tabId: tab.id }),
          }),
        )
        .then(
          () => {
            captureRequestPending = false;
            return refresh();
          },
          (cause) => {
            captureRequestPending = false;
            return refresh(errorText(cause));
          },
        );
      void refresh();
    });
    const library = element("a", "Open library");
    library.href = browser.runtime.getURL("/library.html");
    library.target = "_blank";
    library.addEventListener("click", (event) => {
      event.preventDefault();
      const open = (): Promise<unknown> => browser.tabs.create({ url: library.href });
      if (view.recentCapture === undefined) {
        void open();
        return;
      }
      void dismissSeenCapture(view.recentCapture.jobId).then(open, open);
    });
    const lock = element("button", "Lock Vault", "quiet");
    lock.addEventListener("click", () => void request("LockVault").then((next) => render(next)));
    const actions = element("div", undefined, "actions");
    actions.append(capture, library, lock);
    content.append(actions);
  }
  app.replaceChildren(content);
  app.setAttribute("aria-busy", "false");
}

let refreshRequested = false;
let refreshRunning = false;

function reconcile(): void {
  refreshRequested = true;
  if (refreshRunning) return;
  refreshRunning = true;
  void (async () => {
    while (refreshRequested) {
      refreshRequested = false;
      await refresh();
    }
  })().finally(() => {
    refreshRunning = false;
    if (refreshRequested) reconcile();
  });
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "AppStateChanged"
  ) {
    announcer.textContent = "Vault state updated";
    reconcile();
  }
  return undefined;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconcile();
});
window.addEventListener("focus", reconcile);

reconcile();
