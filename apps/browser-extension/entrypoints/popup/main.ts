import { browser } from "wxt/browser";
import { AppClientError, sendRequest } from "../../src/app/client";
import type { AppStateV1 } from "../../src/app/protocol";
import { popupView } from "../../src/ui/popup-view";

function requiredElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error("Popup shell is incomplete.");
  return node;
}

const app = requiredElement("#app");
const announcer = requiredElement("#announcer");
let visibleRecentCaptureJobId: string | undefined;

function dismissSeenCapture(jobId: string): Promise<AppStateV1> {
  if (visibleRecentCaptureJobId === jobId) visibleRecentCaptureJobId = undefined;
  return sendRequest<AppStateV1>({
    version: 1,
    type: "DismissRecentCapture",
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

function request(type: "GetState" | "UnlockDevice" | "LockVault"): Promise<AppStateV1> {
  return sendRequest<AppStateV1>({ version: 1, type });
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

async function refresh(error?: string): Promise<void> {
  try {
    render(await request("GetState"), error);
  } catch (cause) {
    app.replaceChildren(heading("Local archive"), status(errorText(cause), "error"));
    app.setAttribute("aria-busy", "false");
  }
}

function render(state: AppStateV1, transientError?: string): void {
  const view = popupView(state);
  visibleRecentCaptureJobId = view.screen === "ready" ? view.recentCapture?.jobId : undefined;
  const content = document.createDocumentFragment();
  content.append(
    heading(view.screen === "onboarding" ? "Create your local Vault" : "Archive this page"),
  );
  if (transientError !== undefined) content.append(status(transientError, "error"));

  if (view.screen === "onboarding") {
    content.append(
      element("p", "Your captures are encrypted locally. No account or server is required."),
    );
    const form = element("form");
    const choice = element("label", undefined, "check");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    choice.append(checkbox, document.createTextNode(" Add a passphrase unlock slot"));
    const passphraseLabel = element("label", "Passphrase (optional)");
    const passphrase = element("input");
    passphrase.type = "password";
    passphrase.autocomplete = "new-password";
    passphrase.disabled = true;
    passphraseLabel.append(passphrase);
    checkbox.addEventListener("change", () => {
      passphrase.disabled = !checkbox.checked;
      if (checkbox.checked) passphrase.focus();
    });
    const submit = element("button", "Create Vault", "primary");
    submit.type = "submit";
    form.append(choice, passphraseLabel, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      void sendRequest<AppStateV1>({
        version: 1,
        type: "CreateVault",
        ...(checkbox.checked ? { passphrase: passphrase.value } : {}),
      }).then(
        (next) => render(next),
        (cause) => refresh(errorText(cause)),
      );
    });
    content.append(form);
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
    if (view.passphraseAvailable) {
      const form = element("form");
      const label = element("label", "Or use your passphrase");
      const input = element("input");
      input.type = "password";
      input.required = true;
      input.autocomplete = "current-password";
      label.append(input);
      const submit = element("button", "Unlock with passphrase");
      submit.type = "submit";
      form.append(label, submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit.disabled = true;
        void sendRequest<AppStateV1>({
          version: 1,
          type: "UnlockPassphrase",
          passphrase: input.value,
        }).then(
          (next) => render(next),
          (cause) => refresh(errorText(cause)),
        );
      });
      content.append(form);
    }
  } else if (view.screen === "capturing") {
    content.append(status(`Capturing: ${view.stage}…`));
    announcer.textContent = `Capture stage ${view.stage}`;
    window.setTimeout(() => void refresh(), 500);
  } else {
    if (view.recentCapture !== undefined) {
      const recentCapture = view.recentCapture;
      const cardGroup = element("div", undefined, "recent-capture-group");
      const card = element("a", undefined, "recent-capture");
      card.href = `${browser.runtime.getURL("/library.html")}?bundleId=${encodeURIComponent(recentCapture.bundleId)}`;
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
        thumbnail.src = `data:image/png;base64,${recentCapture.screenshotBase64}`;
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
      announcer.textContent = "Capture started";
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) =>
          sendRequest<{ readonly bundleId: string }>({
            version: 1,
            type: "CaptureActivePage",
            ...(tab?.id === undefined ? {} : { tabId: tab.id }),
          }),
        )
        .then(
          () => refresh(),
          (cause) => refresh(errorText(cause)),
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

void refresh();

window.addEventListener("pagehide", () => {
  const jobId = visibleRecentCaptureJobId;
  if (jobId !== undefined) void dismissSeenCapture(jobId).catch(() => undefined);
});
