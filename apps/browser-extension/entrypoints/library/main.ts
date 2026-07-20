import { browser } from "wxt/browser";
import { base64ToBytes } from "../../src/app/base64";
import { AppClientError, sendRequest } from "../../src/app/client";
import type {
  AppRequest,
  AppState,
  ArtifactChunkMessage,
  LibraryDetailMessage,
  LibraryOperationReceipt,
  LibraryPageGroupMessage,
  OpenArtifactMessage,
} from "../../src/app/protocol";
import type { ArtifactRole } from "../../src/domain/artifact-graph";
import { decodeStructuredContentSequence } from "../../src/domain/structured-content";
import { ChromeVaultImportHost } from "../../src/hosts/chrome/import";
import { serverPermissionPattern } from "../../src/runtime/account/server";
import {
  captureDropRequest,
  collectionLayerBundleIds,
  dragImageHotspot,
  formatByteSize,
  libraryGroupDestination,
  libraryStateConfirmation,
  mergeDropRequest,
} from "../../src/ui/library-view";
import { deepLinkVaultRoute, vaultManagementView } from "../../src/ui/vault-management-view";

function requiredElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error("Library shell is incomplete.");
  return node;
}

const app = requiredElement("#app");
const announcer = requiredElement("#announcer");
const pageHeader = requiredElement("header");
const libraryTitle = requiredElement("#library-title");
const accountSettings = requiredElement("#account-settings") as HTMLButtonElement;
let screenshotUrl: string | undefined;
let detailController: AbortController | undefined;
let activeGroups: readonly LibraryPageGroupMessage[] = [];
let deletedGroups: readonly LibraryPageGroupMessage[] = [];
let undoTimer: number | undefined;
let undoNotice: HTMLElement | undefined;
let draggedCollectionId: string | undefined;
let activeVaultId: string | undefined;
let editingVaultId: string | undefined;
let vaultMutationDisabled = false;
let expandedLibrarySection: "Active" | "Deleted" = "Active";
const importHost = new ChromeVaultImportHost();
let importRouteOpened = false;
let cancelPageOwnedImport: (() => void) | undefined;
let pageOwnedImportJobId: string | undefined;
let abortPageOwnedImport: (() => void) | undefined;
let closePageOwnedImport: (() => void) | undefined;
let renderedState: AppState | undefined;
let staleRecoveryDialogOpened = false;
let libraryOperationError: string | undefined;

function expectedVaultId(): string {
  if (activeVaultId === undefined) throw new Error("No active Vault is selected.");
  return activeVaultId;
}

type ManagementRequest = Extract<
  AppRequest,
  {
    readonly type: "MergeCollections" | "MoveCaptures" | "ExtractCaptures" | "UndoLibraryOperation";
  }
>;

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

function showAccountSettings(): void {
  const state = renderedState;
  if (state === undefined) return;
  const { dialog, form } = dialogShell("Account and synchronization");
  const account = state.account;
  const server =
    account.configuration.mode === "Configured"
      ? account.configuration.serverOrigin
      : account.configuration.mode === "LocalOnly"
        ? "Local only"
        : "Not chosen";
  form.append(
    element("p", `Server · ${server}`, "muted"),
    element("p", `Account · ${account.email ?? "Not signed in"}`, "muted"),
    element("p", `Synchronization · ${account.vaultSyncState}`, "muted"),
  );
  const serverSwitch = state.serverSwitch;
  if (serverSwitch !== undefined) {
    if (serverSwitch.state === "Conflict") form.append(element("h3", "Server switch conflict"));
    form.append(
      element("p", `Candidate · ${serverSwitch.candidateOrigin}`, "muted"),
      element(
        "p",
        serverSwitch.state === "AuthenticationRequired"
          ? "Sign in to the candidate server. Your current server remains active while AWSM compares both Vaults."
          : serverSwitch.state === "Comparing"
            ? "Comparing authenticated Vault history… Your current server is still active."
            : serverSwitch.state === "Applying"
              ? serverSwitch.direction === "PublishLocal"
                ? "Publishing this Vault to the candidate server…"
                : serverSwitch.direction === "FastForwardCandidate"
                  ? "Fast-forwarding the candidate server…"
                  : serverSwitch.direction === "FastForwardLocal"
                    ? "Fast-forwarding this device…"
                    : serverSwitch.direction === "Union"
                      ? "Combining compatible append-only history…"
                      : "Applying the verified reconciliation…"
              : serverSwitch.state === "VaultLocked"
                ? "Unlock this Vault to continue the server change."
                : serverSwitch.state === "Conflict"
                  ? serverSwitch.candidateAuthorityChanged === true
                    ? `Server switch stopped after a concurrent change. Some verified append-only history reached the candidate server before its history changed. Your active Vault is still synchronizing with ${server}. Neither Vault was overwritten.`
                    : `AWSM could not prove a safe fast-forward (${serverSwitch.reason ?? "unknown history"}). No changes were made. AWSM is still synchronizing with ${server}.`
                  : serverSwitch.errorId === "SERVER_SWITCH_VAULT_MISMATCH"
                    ? "This Account already contains a different Vault. Your current server is unchanged."
                    : `The switch stopped safely (${serverSwitch.errorId ?? "unexpected failure"}). Your current server is unchanged.`,
        serverSwitch.state === "Conflict" || serverSwitch.state === "Failed"
          ? "notice error"
          : "notice",
      ),
    );
    if (serverSwitch.state === "AuthenticationRequired") {
      const emailLabel = element("label", "Email");
      const email = element("input");
      email.type = "email";
      email.required = true;
      email.autocomplete = "username";
      emailLabel.append(email);
      const passwordLabel = element("label", "Password");
      const password = element("input");
      password.type = "password";
      password.required = true;
      password.autocomplete = "current-password";
      passwordLabel.append(password);
      form.append(emailLabel, passwordLabel);
      const candidateActions = element("div", undefined, "actions");
      const login = element("button", "Sign in");
      login.type = "button";
      const signup = element("button", "Create account");
      signup.type = "button";
      const authenticate = (type: "LoginServerSwitchCandidate" | "SignupServerSwitchCandidate") => {
        login.disabled = true;
        signup.disabled = true;
        void sendRequest<AppState>({ type, email: email.value, password: password.value }).then(
          (next) => {
            dialog.close();
            renderVaultBar(next);
          },
          (error) => {
            login.disabled = false;
            signup.disabled = false;
            form.querySelector(".error")?.remove();
            form.append(
              element(
                "p",
                error instanceof AppClientError
                  ? error.message
                  : "The candidate Account could not be authenticated.",
                "notice error",
              ),
            );
          },
        );
      };
      login.addEventListener("click", () => authenticate("LoginServerSwitchCandidate"));
      signup.addEventListener("click", () => authenticate("SignupServerSwitchCandidate"));
      candidateActions.append(login, signup);
      form.append(candidateActions);
    }
    if (serverSwitch.state === "Failed") {
      const retrySwitch = element("button", "Try candidate again");
      retrySwitch.type = "button";
      retrySwitch.addEventListener("click", () => {
        retrySwitch.disabled = true;
        void sendRequest<AppState>({ type: "RetryServerSwitch", jobId: serverSwitch.jobId }).then(
          (next) => {
            dialog.close();
            renderVaultBar(next);
          },
          () => {
            retrySwitch.disabled = false;
          },
        );
      });
      form.append(retrySwitch);
    }
    if (serverSwitch.state !== "Applying" && serverSwitch.state !== "VaultLocked") {
      const keepSource = element(
        "button",
        serverSwitch.state === "Conflict" || serverSwitch.state === "Failed"
          ? "Try another server"
          : "Cancel server change",
      );
      keepSource.type = "button";
      keepSource.addEventListener("click", () => {
        keepSource.disabled = true;
        void sendRequest<AppState>({ type: "CancelServerSwitch", jobId: serverSwitch.jobId }).then(
          (next) => {
            dialog.close();
            renderVaultBar(next);
          },
          () => {
            keepSource.disabled = false;
          },
        );
      });
      form.append(keepSource);
    }
    form.append(element("button", "Close"));
    (form.lastElementChild as HTMLButtonElement).type = "button";
    form.lastElementChild?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => accountSettings.focus(), { once: true });
    dialog.showModal();
    return;
  }
  const actions = element("div", undefined, "actions");
  if (account.vaultSyncState === "SetupRequired") {
    const finish = element("button", "Finish setup");
    finish.type = "button";
    finish.addEventListener("click", () => {
      void browser.tabs.create({ url: browser.runtime.getURL("/signup.html") });
      dialog.close();
    });
    actions.append(finish);
  }
  if (account.vaultSyncState === "Failed" || account.vaultSyncState === "Offline") {
    const retry = element("button", "Retry synchronization");
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      void sendRequest<AppState>({ type: "RetrySynchronization" }).then(
        (next) => {
          dialog.close();
          renderVaultBar(next);
        },
        () => {
          retry.disabled = false;
        },
      );
    });
    actions.append(retry);
  }
  if (account.accountState === "Authenticated") {
    const logout = element("button", "Sign out");
    logout.type = "button";
    logout.addEventListener("click", () => {
      logout.disabled = true;
      void sendRequest<AppState>({ type: "LogoutAccount" }).then((next) => {
        dialog.close();
        renderVaultBar(next);
      });
    });
    actions.append(logout);
  }
  form.append(actions);
  const serverLabel = element(
    "label",
    account.configuration.mode === "Configured"
      ? "Change synchronization server"
      : "Add synchronization server",
  );
  const origin = element("input");
  origin.type = "url";
  origin.required = true;
  origin.placeholder = "https://sync.example.com";
  origin.value =
    account.configuration.mode === "Configured"
      ? account.configuration.serverOrigin
      : "https://awsm.foo";
  serverLabel.append(origin);
  form.append(serverLabel);
  if (account.configuration.mode === "Configured") {
    const warning = element("label", undefined, "warning-confirmation");
    const confirmed = element("input");
    confirmed.type = "checkbox";
    confirmed.required = true;
    warning.append(
      confirmed,
      document.createTextNode(
        " AWSM will verify and reconcile the candidate before changing the active server.",
      ),
    );
    form.append(warning);
  }
  const controls = element("div", undefined, "actions");
  const save = element(
    "button",
    account.configuration.mode === "Configured" ? "Change server" : "Connect server",
  );
  save.type = "submit";
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  controls.append(save, cancel);
  form.append(controls);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    void browser.permissions
      .request({ origins: [serverPermissionPattern(origin.value)] })
      .then((granted) => {
        if (!granted)
          throw new AppClientError(
            "SERVER_PERMISSION_DENIED",
            "Chrome did not grant access to that synchronization server.",
          );
        return account.configuration.mode === "Configured"
          ? sendRequest<AppState>({
              type: "BeginServerSwitch",
              candidateOrigin: origin.value,
              expectedVaultId: expectedVaultId(),
            })
          : sendRequest<AppState>({
              type: "ConfigureSyncServer",
              serverOrigin: origin.value,
            });
      })
      .then(
        (next) => {
          dialog.close();
          renderVaultBar(next);
        },
        (error) => {
          save.disabled = false;
          form.querySelector(".error")?.remove();
          form.append(
            element(
              "p",
              error instanceof AppClientError ? error.message : "The server could not be changed.",
              "notice error",
            ),
          );
        },
      );
  });
  dialog.addEventListener("close", () => accountSettings.focus(), { once: true });
  dialog.showModal();
}

accountSettings.addEventListener("click", showAccountSettings);

async function showCreateVaultDialog(restoreFocus: HTMLElement): Promise<void> {
  const suggestion = await sendRequest<{ readonly name: string }>({
    type: "SuggestVaultName",
  });
  const { dialog, form } = dialogShell("Create another Vault");
  form.append(
    element(
      "p",
      activeVaultId === undefined
        ? "Create an encrypted local Vault."
        : "Creating another Vault locks the current Vault.",
      "muted",
    ),
  );
  const label = element("label", "Vault name");
  const name = element("input");
  name.value = suggestion.name;
  name.required = true;
  name.maxLength = 64;
  label.append(name);
  const regenerate = element("button", "Generate another name");
  regenerate.type = "button";
  regenerate.addEventListener("click", () => {
    regenerate.disabled = true;
    void sendRequest<{ readonly name: string }>({
      type: "SuggestVaultName",
    }).then(
      (next) => {
        name.value = next.name;
        name.focus();
        name.select();
        regenerate.disabled = false;
      },
      () => {
        regenerate.disabled = false;
      },
    );
  });
  const controls = element("div", undefined, "actions");
  const submit = element("button", "Create Vault");
  submit.type = "submit";
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  controls.append(submit, cancel);
  form.append(label, regenerate, controls);
  form.onsubmit = (event) => {
    event.preventDefault();
    submit.disabled = true;
    void sendRequest<AppState>({
      type: "CreateVault",
      ...(activeVaultId === undefined ? {} : { expectedActiveVaultId: activeVaultId }),
      name: name.value,
    }).then(
      async (next) => {
        dialog.close();
        renderVaultBar(next);
        announcer.textContent = `Created and selected ${name.value}.`;
        const active = next.workspace.vaults.find((vault) => vault.active);
        if (active?.unlocked === true) await loadList();
        else await showUnlock();
      },
      async (error) => {
        dialog.close();
        await handleContextError(error);
      },
    );
  };
  dialog.addEventListener("close", () => restoreFocus.focus(), { once: true });
  dialog.showModal();
  name.focus();
  name.select();
}

function showImportVaultDialog(restoreFocus: HTMLElement): void {
  const { dialog, form } = dialogShell("Import encrypted Vault");
  const title = form.querySelector("h2");
  if (title === null) throw new Error("Import dialog title is missing.");
  const host = importHost;
  let jobId: string | undefined;
  let backgroundOwned = false;
  let closing = false;
  const acquisition = new AbortController();
  const cancel = async (): Promise<void> => {
    acquisition.abort();
    if (jobId !== undefined) {
      await sendRequest<null>({ type: "CancelVaultImport", jobId }).catch(() => undefined);
    }
  };
  cancelPageOwnedImport = () => void cancel();
  const close = (): void => {
    closing = true;
    dialog.close();
  };
  const renderAuthenticate = (fileSize: number, feedback?: string): void => {
    const passphraseLabel = element("label", "Export passphrase");
    const passphrase = element("input");
    passphrase.type = "password";
    passphrase.required = true;
    passphrase.autocomplete = "current-password";
    passphrase.setAttribute("aria-describedby", "import-passphrase-help import-feedback");
    passphraseLabel.append(passphrase);
    const help = element(
      "p",
      `Staged ${formatByteSize(fileSize)}. The passphrase is not saved and will not unlock the imported local Vault.`,
      "muted",
    );
    help.id = "import-passphrase-help";
    const error = element("p", feedback ?? "", "notice error");
    error.id = "import-feedback";
    error.setAttribute("role", "alert");
    error.hidden = feedback === undefined;
    const actions = element("div", undefined, "actions");
    const submit = element("button", "Import Vault");
    submit.type = "submit";
    const cancelButton = element("button", "Cancel Import");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => void cancel().then(close));
    actions.append(submit, cancelButton);
    form.replaceChildren(title, passphraseLabel, help, error, actions);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (jobId === undefined) return;
      submit.disabled = true;
      cancelButton.disabled = false;
      let secret = passphrase.value;
      passphrase.value = "";
      const importRequest = sendRequest<{
        readonly jobId: string;
        readonly vaultId: string;
      }>({
        type: "ImportVault",
        jobId,
        passphrase: secret,
      });
      secret = "";
      void (async () => {
        while (!backgroundOwned && dialog.open) {
          const state = await sendRequest<AppState>({ type: "GetState" });
          const job = state.latestImportJob;
          if (job?.jobId === jobId && (job.state === "Running" || job.state === "Succeeded")) {
            backgroundOwned = true;
            cancelPageOwnedImport = undefined;
            announcer.textContent =
              "Authenticated Vault Package. Import continues in the background.";
            close();
            return;
          }
          if (job?.state === "Failed" || job?.state === "Cancelled") return;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
      })().catch(() => undefined);
      void importRequest.then(
        async (result) => {
          backgroundOwned = true;
          cancelPageOwnedImport = undefined;
          if (dialog.open) close();
          const state = await sendRequest<AppState>({ type: "GetState" });
          const imported = state.workspace.vaults.find((vault) => vault.vaultId === result.vaultId);
          announcer.textContent = `Imported ${imported?.name ?? "Vault"} as a locked Vault.`;
          reconcile();
        },
        async (cause) => {
          if (cause instanceof AppClientError && cause.id === "IMPORT_AUTHENTICATION_FAILED") {
            renderAuthenticate(
              fileSize,
              "The Vault Package could not be authenticated. Check the passphrase and try again.",
            );
            const next = form.querySelector<HTMLInputElement>('input[type="password"]');
            next?.focus();
            next?.select();
            return;
          }
          const state = await sendRequest<AppState>({ type: "GetState" }).catch(() => undefined);
          const job = state?.latestImportJob;
          if (job !== undefined && job.jobId === jobId && job.destinationVaultId !== undefined) {
            backgroundOwned = true;
            cancelPageOwnedImport = undefined;
            if (dialog.open) close();
            announcer.textContent = "Vault Import stopped safely after authentication.";
            reconcile();
            return;
          }
          error.textContent =
            cause instanceof AppClientError ? cause.message : "Vault Import failed safely.";
          error.hidden = false;
          submit.disabled = true;
          cancelButton.textContent = "Close";
          cancelButton.onclick = close;
        },
      );
    };
    passphrase.focus();
  };
  const intro = element(
    "p",
    "Choose an encrypted AWSM .awsm package. Import adds it as a locked Vault.",
    "muted",
  );
  const fileLabel = element("label", "Vault Package");
  const file = element("input");
  file.type = "file";
  file.accept = ".awsm,application/vnd.awsm.vault+zip";
  file.required = true;
  fileLabel.append(file);
  const feedback = element("p", "", "notice error");
  feedback.hidden = true;
  feedback.setAttribute("role", "alert");
  const actions = element("div", undefined, "actions");
  const begin = element("button", "Continue");
  begin.type = "submit";
  const dismiss = element("button", "Cancel");
  dismiss.type = "button";
  dismiss.addEventListener("click", close);
  actions.append(begin, dismiss);
  form.append(intro, fileLabel, feedback, actions);
  form.onsubmit = (event) => {
    event.preventDefault();
    const source = file.files?.[0];
    if (source === undefined) return;
    begin.disabled = true;
    dismiss.textContent = "Cancel Import";
    const progress = element("progress") as HTMLProgressElement;
    progress.max = source.size;
    progress.value = 0;
    progress.setAttribute("aria-label", "Vault Package acquisition progress");
    const progressText = element("p", `Copied 0 of ${formatByteSize(source.size)}`, "muted");
    form.replaceChildren(title, progressText, progress, dismiss);
    dismiss.onclick = () => void cancel().then(close);
    void sendRequest<{ readonly jobId: string }>({
      type: "BeginVaultImport",
      sourceByteLength: source.size,
    })
      .then(async (started) => {
        jobId = started.jobId;
        pageOwnedImportJobId = started.jobId;
        abortPageOwnedImport = () => acquisition.abort();
        closePageOwnedImport = () => {
          announcer.textContent = "Vault Import cancelled.";
          close();
        };
        if (acquisition.signal.aborted) {
          await sendRequest<null>({ type: "CancelVaultImport", jobId });
          throw new DOMException("Import acquisition was cancelled.", "AbortError");
        }
        let lastReportedAt = 0;
        let lastReportedBytes = 0;
        await host.stage({
          jobId,
          source,
          signal: acquisition.signal,
          onProgress: async (acquiredBytes) => {
            progress.value = acquiredBytes;
            progressText.textContent = `Copied ${formatByteSize(acquiredBytes)} of ${formatByteSize(source.size)}`;
            const now = performance.now();
            if (
              acquiredBytes !== source.size &&
              now - lastReportedAt < 100 &&
              acquiredBytes - lastReportedBytes < 1024 * 1024
            ) {
              return;
            }
            await sendRequest<null>({
              type: "ReportVaultImportProgress",
              jobId: started.jobId,
              acquiredBytes,
            });
            lastReportedAt = now;
            lastReportedBytes = acquiredBytes;
          },
        });
        await sendRequest<null>({
          type: "CompleteVaultImportStaging",
          jobId: started.jobId,
        });
        renderAuthenticate(source.size);
      })
      .catch(async (cause) => {
        await cancel();
        const state = await sendRequest<AppState>({ type: "GetState" }).catch(() => undefined);
        const latestJob = state?.latestImportJob;
        if (
          acquisition.signal.aborted &&
          latestJob !== undefined &&
          latestJob.jobId === jobId &&
          latestJob.state === "Cancelled"
        ) {
          announcer.textContent = "Vault Import cancelled.";
          close();
          return;
        }
        feedback.textContent =
          cause instanceof AppClientError
            ? cause.message
            : "The Vault Package could not be staged.";
        feedback.hidden = false;
        form.replaceChildren(title, feedback, dismiss);
      });
  };
  dialog.addEventListener(
    "close",
    () => {
      if (!closing) closing = true;
      if (!backgroundOwned) void cancel();
      if (cancelPageOwnedImport !== undefined) cancelPageOwnedImport = undefined;
      if (pageOwnedImportJobId === jobId) {
        pageOwnedImportJobId = undefined;
        abortPageOwnedImport = undefined;
        closePageOwnedImport = undefined;
      }
      dialog.remove();
      requestAnimationFrame(() => {
        const focusTarget = restoreFocus.isConnected
          ? restoreFocus
          : document.querySelector<HTMLElement>("[data-import-vault='true']");
        focusTarget?.focus();
      });
    },
    { once: true },
  );
  dialog.showModal();
  file.focus();
}

function showExportVaultDialog(restoreFocus: HTMLElement): void {
  const { dialog, form } = dialogShell("Export encrypted Vault");
  form.append(
    element(
      "p",
      "Create a complete portable .awsm package. You will need this new passphrase to recover it.",
      "muted",
    ),
  );
  const passphraseLabel = element("label", "Export passphrase");
  const passphrase = element("input");
  passphrase.type = "password";
  passphrase.required = true;
  passphrase.autocomplete = "new-password";
  passphrase.setAttribute("aria-describedby", "export-passphrase-help");
  passphraseLabel.append(passphrase);
  const help = element(
    "p",
    "Use at least 12 characters. This passphrase is not saved and does not unlock the local Vault.",
    "muted",
  );
  help.id = "export-passphrase-help";
  const confirmationLabel = element("label", "Confirm export passphrase");
  const confirmation = element("input");
  confirmation.type = "password";
  confirmation.required = true;
  confirmation.autocomplete = "new-password";
  confirmationLabel.append(confirmation);
  const feedback = element("p", "", "notice error");
  feedback.hidden = true;
  const actions = element("div", undefined, "actions");
  const submit = element("button", "Export Vault");
  submit.type = "submit";
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  actions.append(submit, cancel);
  form.append(passphraseLabel, help, confirmationLabel, feedback, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (
      Array.from(passphrase.value).length < 12 ||
      new TextEncoder().encode(passphrase.value).byteLength > 1024
    ) {
      feedback.textContent = "Use at least 12 characters and no more than 1,024 UTF-8 bytes.";
      feedback.hidden = false;
      passphrase.focus();
      return;
    }
    if (passphrase.value !== confirmation.value) {
      feedback.textContent = "The passphrases do not match.";
      feedback.hidden = false;
      confirmation.focus();
      return;
    }
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "Preparing…";
    const request = sendRequest<{
      readonly jobId: string;
      readonly filename: string;
    }>({
      type: "ExportVault",
      expectedVaultId: expectedVaultId(),
      passphrase: passphrase.value,
    });
    passphrase.value = "";
    confirmation.value = "";
    dialog.close();
    announcer.textContent = "Encrypted Vault Export started.";
    void request.then(
      (result) => {
        announcer.textContent = `Export downloaded as ${result.filename}`;
        reconcile();
      },
      (error) => {
        announcer.textContent =
          error instanceof AppClientError ? error.message : "Vault Export failed.";
        reconcile();
      },
    );
  });
  dialog.addEventListener("close", () => restoreFocus.focus(), { once: true });
  dialog.showModal();
  passphrase.focus();
}

function showStaleReplicaRecoveryDialog(restoreFocus: HTMLElement): void {
  const state = renderedState;
  const active = state?.workspace.vaults.find((vault) => vault.active);
  if (state === undefined || active === undefined || !active.unlocked) return;
  const { dialog, form } = dialogShell("Resolve stale synchronized Vault");
  const warning = element("section", undefined, "notice recovery-warning");
  warning.append(
    element("h3", "The server copy will replace this Vault"),
    element(
      "p",
      "AWSM will first preserve the current local state as a new local-only Vault with fresh identifiers. It will then completely overwrite this stale synchronized Vault with the server-authoritative data.",
    ),
    element(
      "p",
      "Exporting first is strongly recommended. The encrypted .awsm package can later be imported as another local-only Vault.",
      "warning",
    ),
  );
  const exportHeading = element("h3", "Recommended: export before replacing");
  const passphraseLabel = element("label", "Export passphrase");
  const passphrase = element("input");
  passphrase.type = "password";
  passphrase.autocomplete = "new-password";
  passphraseLabel.append(passphrase);
  const confirmationLabel = element("label", "Confirm export passphrase");
  const confirmation = element("input");
  confirmation.type = "password";
  confirmation.autocomplete = "new-password";
  confirmationLabel.append(confirmation);
  const exportButton = element("button", "Export encrypted Vault");
  exportButton.type = "button";
  const exportStatus = element("p", "No recovery Export has been created yet.", "muted");
  const skipHeading = element("h3", "Continue without an Export");
  const skip = element("label", undefined, "warning-confirmation");
  const skipCheckbox = element("input");
  skipCheckbox.type = "checkbox";
  skip.append(
    skipCheckbox,
    document.createTextNode(" I understand that I am declining the recommended encrypted Export."),
  );
  const overwrite = element("label", undefined, "warning-confirmation");
  const overwriteCheckbox = element("input");
  overwriteCheckbox.type = "checkbox";
  overwrite.append(
    overwriteCheckbox,
    document.createTextNode(
      " I understand that the stale synchronized Vault will be completely overwritten by server data.",
    ),
  );
  const feedback = element("p", "", "notice error");
  feedback.hidden = true;
  const actions = element("div", undefined, "actions");
  const resolve = element("button", "Preserve local copy and use server data");
  resolve.type = "submit";
  resolve.className = "danger-action";
  resolve.disabled = true;
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  actions.append(resolve, cancel);
  let exported = false;
  let activating = false;
  const updateResolve = (): void => {
    resolve.disabled = !exported && !(skipCheckbox.checked && overwriteCheckbox.checked);
  };
  skipCheckbox.addEventListener("change", updateResolve);
  overwriteCheckbox.addEventListener("change", updateResolve);
  exportButton.addEventListener("click", () => {
    feedback.hidden = true;
    if (
      Array.from(passphrase.value).length < 12 ||
      new TextEncoder().encode(passphrase.value).byteLength > 1024
    ) {
      feedback.textContent = "Use at least 12 characters and no more than 1,024 UTF-8 bytes.";
      feedback.hidden = false;
      passphrase.focus();
      return;
    }
    if (passphrase.value !== confirmation.value) {
      feedback.textContent = "The passphrases do not match.";
      feedback.hidden = false;
      confirmation.focus();
      return;
    }
    exportButton.disabled = true;
    exportButton.textContent = "Preparing encrypted Export…";
    const request = sendRequest<{ readonly jobId: string; readonly filename: string }>({
      type: "ExportVault",
      expectedVaultId: active.vaultId,
      passphrase: passphrase.value,
    });
    passphrase.value = "";
    confirmation.value = "";
    void request.then(
      (result) => {
        exported = true;
        exportButton.textContent = "Export downloaded";
        exportStatus.textContent = `Encrypted recovery Export downloaded as ${result.filename}.`;
        skipCheckbox.checked = false;
        overwriteCheckbox.checked = false;
        skipCheckbox.disabled = true;
        overwriteCheckbox.disabled = true;
        updateResolve();
      },
      (error) => {
        exportButton.disabled = false;
        exportButton.textContent = "Try Export again";
        feedback.textContent =
          error instanceof AppClientError ? error.message : "The encrypted Export failed safely.";
        feedback.hidden = false;
      },
    );
  });
  form.append(
    warning,
    exportHeading,
    passphraseLabel,
    confirmationLabel,
    exportButton,
    exportStatus,
    skipHeading,
    skip,
    overwrite,
    feedback,
    actions,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (resolve.disabled) return;
    activating = true;
    resolve.disabled = true;
    cancel.disabled = true;
    exportButton.disabled = true;
    skipCheckbox.disabled = true;
    overwriteCheckbox.disabled = true;
    resolve.textContent = "Preserving and replacing…";
    feedback.className = "notice";
    feedback.textContent =
      "Keep this page open. AWSM is verifying the server copy before changing either Vault.";
    feedback.hidden = false;
    const minimumBusyDisplay = new Promise<void>((resolveDelay) => {
      window.setTimeout(resolveDelay, 750);
    });
    void sendRequest<{ readonly forkVaultId: string }>({
      type: "ResolveStaleReplica",
      expectedVaultId: active.vaultId,
      exportDecision: exported ? "Exported" : "SkipConfirmed",
    }).then(
      async () => {
        await minimumBusyDisplay;
        activating = false;
        dialog.close();
        announcer.textContent =
          "The synchronized Vault now matches the server. A local-only recovered copy was created.";
        await initialize();
      },
      async (error) => {
        await minimumBusyDisplay;
        activating = false;
        cancel.disabled = false;
        resolve.textContent = "Preserve local copy and use server data";
        updateResolve();
        feedback.className = "notice error";
        feedback.textContent =
          error instanceof AppClientError
            ? error.message
            : "Recovery stopped safely before activation. Try again.";
      },
    );
  });
  dialog.addEventListener("cancel", (event) => {
    if (activating) event.preventDefault();
  });
  dialog.addEventListener("close", () => restoreFocus.focus(), { once: true });
  dialog.showModal();
  passphrase.focus();
}

function renderLibraryTitle(state: AppState, restoreFocus = false): void {
  const view = vaultManagementView(state.workspace);
  const active = state.workspace.vaults.find((vault) => vault.active);
  const heading = element("h1");
  if (active === undefined) {
    heading.textContent = "Your local library";
    libraryTitle.replaceChildren(heading);
    return;
  }
  if (!active.unlocked || view.managementDisabled) {
    heading.textContent = active.name;
    libraryTitle.replaceChildren(heading);
    return;
  }
  const rename = element("button", active.name, "vault-title-button");
  rename.type = "button";
  rename.setAttribute("aria-label", `Rename ${active.name}`);
  rename.addEventListener("click", () => {
    if (editingVaultId !== undefined) return;
    editingVaultId = active.vaultId;
    const form = element("form", undefined, "library-title-edit");
    const label = element("label", "Vault name", "sr-only");
    const input = element("input");
    input.id = `vault-name-${active.vaultId}`;
    label.htmlFor = input.id;
    input.value = active.name;
    input.required = true;
    input.maxLength = 64;
    const submit = element("button", "Rename");
    submit.type = "submit";
    let submitting = false;
    const finish = (restoreTitleFocus = false): void => {
      editingVaultId = undefined;
      renderLibraryTitle(state, restoreTitleFocus);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      }
    });
    form.append(label, input, submit);
    form.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (!submitting && (!(next instanceof Node) || !form.contains(next))) finish();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitting = true;
      submit.disabled = true;
      submit.textContent = "Renaming…";
      void sendRequest<AppState>({
        type: "RenameVault",
        expectedActiveVaultId: active.vaultId,
        vaultId: active.vaultId,
        name: input.value,
      }).then(
        (next) => {
          editingVaultId = undefined;
          renderVaultBar(next);
          const renamed = next.workspace.vaults.find((vault) => vault.active)?.name ?? active.name;
          announcer.textContent = `Vault renamed to ${renamed}`;
          libraryTitle.querySelector<HTMLButtonElement>(".vault-title-button")?.focus();
        },
        async (error) => {
          if (error instanceof AppClientError && error.id === "VAULT_CONTEXT_CHANGED") {
            editingVaultId = undefined;
            await handleContextError(error);
            return;
          }
          submitting = false;
          submit.disabled = false;
          submit.textContent = "Rename";
          const message =
            error instanceof AppClientError ? error.message : "The Vault could not be renamed.";
          form.querySelector(".error")?.remove();
          form.append(element("p", message, "notice error"));
          input.focus();
        },
      );
    });
    libraryTitle.replaceChildren(form);
    input.focus();
    input.select();
  });
  heading.append(rename);
  libraryTitle.replaceChildren(heading);
  if (restoreFocus) rename.focus();
}

function appendImportJobStatus(bar: HTMLElement, state: AppState, currentVaultId?: string): void {
  const importJob = state.latestImportJob;
  if (importJob === undefined) return;
  if (importJob.state === "Created" || importJob.state === "Running") {
    const progress =
      importJob.stage === "Acquire"
        ? `${formatByteSize(importJob.acquiredBytes)} of ${formatByteSize(importJob.sourceByteLength)}`
        : `${String(importJob.completedEntries)} of ${String(importJob.totalEntries)} entries`;
    bar.append(element("p", `Import · ${importJob.stage} · ${progress}`, "muted"));
    const cancelImport = element("button", "Cancel Import");
    cancelImport.disabled = importJob.cancellationRequested || importJob.stage === "Commit";
    cancelImport.addEventListener("click", () => {
      cancelImport.disabled = true;
      void sendRequest<null>({
        type: "CancelVaultImport",
        jobId: importJob.jobId,
      }).catch(() => reconcile());
    });
    bar.append(cancelImport);
    return;
  }
  if (importJob.state === "Failed") {
    const message =
      importJob.errorId === "SELECTIVE_IMPORT_UNSUPPORTED"
        ? "This version can import only Complete Vault Packages."
        : importJob.errorId === "VAULT_ALREADY_EXISTS"
          ? "This Vault already exists on this device."
          : importJob.errorId === "IMPORT_INTERRUPTED"
            ? "Import was interrupted before the Vault was added. Select the package and try again."
            : importJob.errorId === "STORAGE_QUOTA_EXCEEDED"
              ? "There is not enough local storage to import this Vault."
              : "This Vault Package is incomplete, corrupt, or unsupported.";
    bar.append(element("p", message, "notice error"));
    return;
  }
  if (importJob.state !== "Succeeded") return;
  const importedVaultId = importJob.destinationVaultId;
  const importedVault = state.workspace.vaults.find((vault) => vault.vaultId === importedVaultId);
  bar.append(
    element(
      "p",
      importedVault?.active === true && importedVault.unlocked
        ? "The imported Vault is ready."
        : "The imported Vault is ready and locked.",
      "muted",
    ),
  );
  if (
    currentVaultId !== undefined &&
    importedVaultId !== undefined &&
    importedVaultId !== currentVaultId &&
    importedVault !== undefined
  ) {
    const switchToImported = element("button", "Switch to imported Vault");
    switchToImported.addEventListener("click", () => {
      switchToImported.disabled = true;
      void sendRequest<AppState>({
        type: "SelectActiveVault",
        expectedActiveVaultId: currentVaultId,
        vaultId: importedVaultId,
      })
        .then(() => reconcile())
        .catch(() => reconcile());
    });
    bar.append(switchToImported);
  }
}

function renderVaultBar(state: AppState): void {
  renderedState = state;
  activeVaultId = state.workspace.activeVaultId;
  document.querySelector("#vault-management")?.remove();
  const view = vaultManagementView(state.workspace);
  vaultMutationDisabled = view.managementDisabled;
  const active = state.workspace.vaults.find((vault) => vault.active);
  if (
    active === undefined ||
    (editingVaultId !== undefined &&
      (editingVaultId !== active.vaultId || !active.unlocked || view.managementDisabled))
  ) {
    editingVaultId = undefined;
  }
  if (editingVaultId === undefined) renderLibraryTitle(state);
  if (active === undefined) {
    if (state.latestImportJob !== undefined) {
      const bar = element("section", undefined, "vault-control");
      bar.id = "vault-management";
      appendImportJobStatus(bar, state);
      pageHeader.after(bar);
    }
    return;
  }
  const bar = element("section", undefined, "vault-control");
  bar.id = "vault-management";
  bar.append(element("p", active.unlocked ? "Unlocked" : "Locked", "muted"));
  if (state.account.staleResolutionRequired === true) {
    bar.append(
      element(
        "p",
        "Synchronization paused: this local Replica is stale and remains read-only until resolved.",
        "notice error",
      ),
    );
    const resolveStale = element("button", "Resolve stale Vault");
    resolveStale.disabled = !active.unlocked;
    resolveStale.addEventListener("click", () => showStaleReplicaRecoveryDialog(resolveStale));
    bar.append(resolveStale);
  }
  if (view.busyText !== undefined) bar.append(element("p", view.busyText, "muted"));
  const actions = element("div", undefined, "actions");
  const switcher = element("button", "Switch Vault");
  switcher.disabled = view.managementDisabled;
  switcher.addEventListener("click", () => {
    const { dialog, form } = dialogShell("Switch Vault");
    form.append(element("p", "Switching locks the current Vault.", "muted"));
    let selectedVaultId = active.vaultId;
    for (const option of view.options) {
      const label = element("label", undefined, "picker__option");
      const radio = element("input");
      radio.type = "radio";
      radio.name = "vault";
      radio.checked = option.current;
      radio.autofocus = option.current;
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
    const controls = element("div", undefined, "actions");
    const choose = element("button", "Switch");
    choose.type = "submit";
    const cancel = element("button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => dialog.close());
    controls.append(choose, cancel);
    form.append(controls);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      choose.disabled = true;
      void sendRequest<AppState>({
        type: "SelectActiveVault",
        expectedActiveVaultId: active.vaultId,
        vaultId: selectedVaultId,
      }).then(
        async (next) => {
          dialog.close();
          renderVaultBar(next);
          announcer.textContent = `Selected ${next.workspace.vaults.find((vault) => vault.active)?.name ?? "Vault"}. Unlock it to continue.`;
          await showUnlock();
        },
        async (error) => {
          dialog.close();
          await handleContextError(error);
        },
      );
    });
    dialog.addEventListener("close", () => switcher.focus(), { once: true });
    dialog.showModal();
  });
  actions.append(switcher);
  const create = element("button", "Create another Vault");
  create.disabled = view.managementDisabled;
  create.addEventListener("click", () => {
    create.disabled = true;
    void showCreateVaultDialog(create).finally(() => {
      create.disabled = view.managementDisabled;
    });
  });
  actions.append(create);
  const importButton = element("button", "Import Vault");
  importButton.dataset.importVault = "true";
  importButton.disabled = view.managementDisabled;
  importButton.addEventListener("click", () => showImportVaultDialog(importButton));
  actions.append(importButton);
  const exportButton = element("button", "Export Vault");
  exportButton.disabled = !active.unlocked || view.managementDisabled;
  exportButton.addEventListener("click", () => showExportVaultDialog(exportButton));
  actions.append(exportButton);
  const exportJob =
    state.latestExportJob?.vaultId === active.vaultId ? state.latestExportJob : undefined;
  if (exportJob !== undefined) {
    if (exportJob.state === "Created" || exportJob.state === "Running") {
      const progress = element(
        "p",
        `Export · ${exportJob.stage} · ${String(exportJob.completedEntries)} of ${String(exportJob.totalEntries)} entries`,
        "muted",
      );
      const cancelExport = element("button", "Cancel Export");
      cancelExport.disabled = exportJob.cancellationRequested;
      cancelExport.addEventListener("click", () => {
        cancelExport.disabled = true;
        void sendRequest<null>({
          type: "CancelVaultExport",
          expectedVaultId: active.vaultId,
          jobId: exportJob.jobId,
        }).catch(() => reconcile());
      });
      bar.append(progress, cancelExport);
    } else if (exportJob.state === "Failed") {
      bar.append(element("p", "The last Vault Export failed safely.", "notice error"));
    } else if (exportJob.state === "Succeeded") {
      bar.append(element("p", "The last encrypted Vault Export was downloaded.", "muted"));
    }
  }
  appendImportJobStatus(bar, state, active.vaultId);
  bar.append(actions);
  pageHeader.after(bar);
}

async function handleContextError(error: unknown): Promise<void> {
  if (error instanceof AppClientError && error.id === "VAULT_CONTEXT_CHANGED") {
    releaseScreenshot();
    activeGroups = [];
    deletedGroups = [];
    announcer.textContent = "The active Vault changed. Library data was refreshed.";
    await initialize();
    return;
  }
  renderError(error instanceof AppClientError ? error.message : "The operation failed safely.");
}

function useTiltedDragPreview(event: DragEvent, source: HTMLElement): void {
  if (event.dataTransfer === null) return;
  const bounds = source.getBoundingClientRect();
  const hotspot = dragImageHotspot(event, bounds);
  const item = source.cloneNode(true);
  if (!(item instanceof HTMLElement)) return;
  const ghost = element("div", undefined, "drag-ghost");
  item.classList.add("drag-ghost__item");
  item.style.width = `${String(bounds.width)}px`;
  item.style.height = `${String(bounds.height)}px`;
  item.style.transformOrigin = `${String(hotspot.x)}px ${String(hotspot.y)}px`;
  ghost.append(item);
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, hotspot.x + 16, hotspot.y + 16);
  window.setTimeout(() => ghost.remove(), 0);
}

function clearMergeDropTargets(): void {
  for (const target of document.querySelectorAll(".library-card--merge-target")) {
    target.classList.remove("library-card--merge-target");
  }
}

function releaseScreenshot(): void {
  detailController?.abort();
  detailController = undefined;
  if (screenshotUrl !== undefined) URL.revokeObjectURL(screenshotUrl);
  screenshotUrl = undefined;
}

async function consumeArtifact(
  bundleId: string,
  role: ArtifactRole,
  signal: AbortSignal,
  consume: (chunk: Uint8Array) => void | Promise<void>,
  openedCallback?: (opened: OpenArtifactMessage) => void | Promise<void>,
): Promise<OpenArtifactMessage> {
  const vaultId = expectedVaultId();
  const opened = await sendRequest<OpenArtifactMessage>({
    type: "OpenArtifact",
    expectedVaultId: vaultId,
    bundleId,
    role,
  });
  try {
    await openedCallback?.(opened);
    for (;;) {
      signal.throwIfAborted();
      const next = await sendRequest<ArtifactChunkMessage>({
        type: "ReadArtifactChunk",
        expectedVaultId: vaultId,
        sessionId: opened.sessionId,
      });
      if (next.done) return opened;
      if (next.chunkBase64 === undefined) throw new Error("Artifact chunk missing");
      await consume(base64ToBytes(next.chunkBase64));
    }
  } finally {
    await sendRequest<null>({
      type: "CancelArtifactSession",
      expectedVaultId: vaultId,
      sessionId: opened.sessionId,
    }).catch(() => undefined);
  }
}

async function downloadArtifact(
  bundleId: string,
  role: ArtifactRole,
  signal: AbortSignal,
): Promise<void> {
  interface ArtifactWritable {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }
  const picker = (
    window as typeof window & {
      showSaveFilePicker?: (options: {
        readonly suggestedName: string;
      }) => Promise<{ createWritable(): Promise<ArtifactWritable> }>;
    }
  ).showSaveFilePicker;
  if (picker === undefined) throw new Error("Streaming file save is unavailable");
  let writer: ArtifactWritable | undefined;
  let succeeded = false;
  try {
    const extension =
      role === "PRIMARY"
        ? "mhtml"
        : role === "TEXT_EXTRACTED"
          ? "txt"
          : role === "CONTENT_STRUCTURED"
            ? "cborseq"
            : "webp";
    const handle = await picker({
      suggestedName: `awsm-${bundleId.slice(0, 8)}-${role.toLowerCase().replaceAll("_", "-")}.${extension}`,
    });
    writer = await handle.createWritable();
    const writable = writer;
    await consumeArtifact(bundleId, role, signal, (chunk) => writable.write(chunk));
    succeeded = true;
  } finally {
    if (writer !== undefined) {
      if (succeeded) await writer.close().catch(() => undefined);
      else await writer.abort().catch(() => undefined);
    }
  }
}

function renderError(message: string): void {
  app.replaceChildren(element("p", message, "notice error"));
  app.setAttribute("aria-busy", "false");
}

function clearUndoNotice(): void {
  if (undoTimer !== undefined) window.clearTimeout(undoTimer);
  undoTimer = undefined;
  undoNotice?.remove();
  undoNotice = undefined;
}

function showUndoNotice(message: string, receipt: LibraryOperationReceipt): void {
  clearUndoNotice();
  const notice = element("div", undefined, "snackbar");
  notice.setAttribute("role", "status");
  notice.append(element("span", message));
  const undo = element("button", "Undo");
  undo.type = "button";
  undo.disabled = vaultMutationDisabled;
  undo.addEventListener("click", () => {
    undo.disabled = true;
    void sendRequest<LibraryOperationReceipt>({
      type: "UndoLibraryOperation",
      expectedVaultId: expectedVaultId(),
      operationEventId: receipt.operationEventId,
    }).then(
      async () => {
        clearUndoNotice();
        await loadList();
        announcer.textContent = "Library change undone";
      },
      async () => {
        clearUndoNotice();
        await loadList();
        announcer.textContent = "The Library changed, so that operation could not be undone";
      },
    );
  });
  notice.append(undo);
  document.body.append(notice);
  undoNotice = notice;
  undoTimer = window.setTimeout(clearUndoNotice, 10_000);
}

async function applyManagement(request: ManagementRequest, message: string): Promise<void> {
  try {
    const receipt = await sendRequest<LibraryOperationReceipt>(request);
    await loadList();
    announcer.textContent = message;
    showUndoNotice(message, receipt);
  } catch (error) {
    if (error instanceof AppClientError && error.id === "VAULT_CONTEXT_CHANGED") {
      await handleContextError(error);
      return;
    }
    if (error instanceof AppClientError && error.id === "LIBRARY_STATE_CHANGED") {
      await loadList();
      announcer.textContent = "The Library changed. Review it and try again.";
      return;
    }
    renderError("The Collection change could not be completed safely.");
  }
}

function dialogShell(title: string): {
  readonly dialog: HTMLDialogElement;
  readonly form: HTMLFormElement;
} {
  const dialog = element("dialog", undefined, "picker") as HTMLDialogElement;
  const form = element("form") as HTMLFormElement;
  form.method = "dialog";
  const heading = element("h2", title);
  heading.id = `dialog-title-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", heading.id);
  form.append(heading);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return { dialog, form };
}

function showMergePicker(destination: LibraryPageGroupMessage): void {
  const candidates = activeGroups.filter(
    (candidate) => candidate.collectionId !== destination.collectionId,
  );
  const { dialog, form } = dialogShell(`Merge collections into ${destination.title}`);
  form.append(
    element(
      "p",
      "Choose one or more collections. Their Active and Deleted captures will join this destination.",
      "muted",
    ),
  );
  const selected = new Set<string>();
  for (const candidate of candidates) {
    const label = element("label", undefined, "picker__option");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.value = candidate.collectionId;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(candidate.collectionId);
      else selected.delete(candidate.collectionId);
    });
    const deletedCount = deletedGroups.find(
      (group) => group.collectionId === candidate.collectionId,
    )?.captures.length;
    label.append(
      checkbox,
      element(
        "span",
        `${candidate.title} · ${String(candidate.captures.length)} Active · ${String(deletedCount ?? 0)} Deleted`,
      ),
    );
    form.append(label);
  }
  if (candidates.length === 0) form.append(element("p", "There are no other Active collections."));
  const actions = element("div", undefined, "actions");
  const submit = element("button", "Merge into this collection");
  submit.type = "submit";
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  actions.append(submit, cancel);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selected.size === 0) return;
    dialog.close();
    void applyManagement(
      {
        type: "MergeCollections",
        expectedVaultId: expectedVaultId(),
        destinationCollectionId: destination.collectionId,
        sourceCollectionIds: [...selected],
      },
      `Merged ${String(selected.size)} ${selected.size === 1 ? "collection" : "collections"} into ${destination.title}`,
    );
  });
  dialog.showModal();
}

function showMovePicker(bundleIds: readonly string[], sourceCollectionId: string): void {
  const candidates = activeGroups.filter(
    (candidate) => candidate.collectionId !== sourceCollectionId,
  );
  const { dialog, form } = dialogShell(
    `Move ${String(bundleIds.length)} ${bundleIds.length === 1 ? "capture" : "captures"}`,
  );
  let destination: string | undefined;
  for (const candidate of candidates) {
    const label = element("label", undefined, "picker__option");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "destination";
    radio.value = candidate.collectionId;
    radio.addEventListener("change", () => {
      destination = candidate.collectionId;
    });
    label.append(
      radio,
      element("span", `${candidate.title} · ${String(candidate.captures.length)} captures`),
    );
    form.append(label);
  }
  if (candidates.length === 0) form.append(element("p", "There are no other Active collections."));
  const actions = element("div", undefined, "actions");
  const submit = element("button", "Move to collection");
  submit.type = "submit";
  const cancel = element("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  actions.append(submit, cancel);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (destination === undefined) return;
    dialog.close();
    void applyManagement(
      {
        type: "MoveCaptures",
        expectedVaultId: expectedVaultId(),
        bundleIds,
        destinationCollectionId: destination,
      },
      `Moved ${String(bundleIds.length)} ${bundleIds.length === 1 ? "capture" : "captures"}`,
    );
  });
  dialog.showModal();
}

function thumbnailFor(group: LibraryPageGroupMessage, bundleId: string): string | undefined {
  return group.captureThumbnails.find((thumbnail) => thumbnail.bundleId === bundleId)
    ?.thumbnailBase64;
}

function thumbnailImage(base64: string, alt: string, className: string): HTMLImageElement {
  const thumbnail = element("img", undefined, className);
  thumbnail.src = `data:image/webp;base64,${base64}`;
  thumbnail.alt = alt;
  return thumbnail;
}

function originalSiteLink(item: {
  readonly title: string;
  readonly originalUrl: string;
}): HTMLAnchorElement {
  const link = element("a", "Visit original site", "external");
  link.href = item.originalUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Visit original site for ${item.title}`);
  return link;
}

function collectionPreview(group: LibraryPageGroupMessage): HTMLElement | undefined {
  const layerIds = collectionLayerBundleIds(group);
  const available = layerIds.flatMap((bundleId, index) => {
    const base64 = thumbnailFor(group, bundleId);
    return base64 === undefined ? [] : [{ bundleId, base64, index }];
  });
  if (available.length === 0) return undefined;
  const preview = element(
    "div",
    undefined,
    group.captures.length > 1 ? "card__preview card__preview--stack" : "card__preview",
  );
  for (const layer of available.toReversed()) {
    const latest = layer.index === 0;
    const image = thumbnailImage(
      layer.base64,
      latest ? `Latest screenshot thumbnail for ${group.title}` : "",
      `card__thumbnail card__thumbnail--layer-${String(layer.index)}`,
    );
    if (!latest) image.setAttribute("aria-hidden", "true");
    preview.append(image);
  }
  return preview;
}

function groupGrid(
  groups: readonly LibraryPageGroupMessage[],
  status: "Active" | "Deleted",
): HTMLElement {
  const grid = element("div", undefined, "grid");
  for (const group of groups) {
    const wrapper = element("article", undefined, "library-card");
    if (status === "Active" && !vaultMutationDisabled) {
      wrapper.draggable = true;
      wrapper.addEventListener("dragstart", (event) => {
        draggedCollectionId = group.collectionId;
        useTiltedDragPreview(event, wrapper);
        event.dataTransfer?.setData("application/x-awsm-collection", group.collectionId);
        if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        announcer.textContent = `Dragging ${group.title} collection`;
      });
      wrapper.addEventListener("dragover", (event) => {
        if (draggedCollectionId === undefined || draggedCollectionId === group.collectionId) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
        clearMergeDropTargets();
        wrapper.classList.add("library-card--merge-target");
      });
      wrapper.addEventListener("dragleave", (event) => {
        if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget)) return;
        wrapper.classList.remove("library-card--merge-target");
      });
      wrapper.addEventListener("drop", (event) => {
        clearMergeDropTargets();
        const source = event.dataTransfer?.getData("application/x-awsm-collection");
        if (source === undefined || source === "") return;
        const request = mergeDropRequest(source, group.collectionId);
        if (request === undefined) return;
        event.preventDefault();
        void applyManagement(
          { ...request, expectedVaultId: expectedVaultId() },
          `Merged a collection into ${group.title}`,
        );
      });
      wrapper.addEventListener("dragend", () => {
        draggedCollectionId = undefined;
        clearMergeDropTargets();
      });
    }
    const card = element("button", undefined, "card");
    card.type = "button";
    const preview = collectionPreview(group);
    if (preview !== undefined) card.append(preview);
    card.append(
      element("strong", group.title),
      element("span", group.originalUrl, "muted"),
      element(
        "span",
        `${String(group.captures.length)} ${group.captures.length === 1 ? "capture" : "captures"} · Latest ${new Date(group.latest.capturedAt).toLocaleString()}`,
        "muted",
      ),
    );
    if (!group.latest.artifactRoles.includes("SCREENSHOT_FULL"))
      card.append(element("span", "Screenshot unavailable", "warning"));
    if (group.latest.warnings.length > 0)
      card.append(element("span", group.latest.warnings.join(", "), "warning"));
    card.addEventListener("click", () => {
      const destination = libraryGroupDestination(group);
      if (destination.screen === "detail") void loadDetail(destination.bundleId);
      else renderGroup(group);
    });
    const stateAction = element(
      "button",
      status === "Active" ? "Delete collection" : "Restore collection",
      status === "Active" ? "remove" : undefined,
    );
    stateAction.type = "button";
    stateAction.disabled = vaultMutationDisabled;
    stateAction.setAttribute(
      "aria-label",
      `${status === "Active" ? "Delete" : "Restore"} ${group.title} collection`,
    );
    stateAction.addEventListener("click", () =>
      confirmAndChangeGroup(group, stateAction, status === "Active" ? "Delete" : "Restore"),
    );
    const cardActions = element("div", undefined, "card-actions");
    cardActions.append(originalSiteLink(group));
    if (status === "Active") {
      const merge = element("button", "Merge with…");
      merge.type = "button";
      merge.disabled = vaultMutationDisabled;
      merge.addEventListener("click", () => showMergePicker(group));
      cardActions.append(merge);
    }
    cardActions.append(stateAction);
    wrapper.append(card, cardActions);
    grid.append(wrapper);
  }
  return grid;
}

function vacuumControl(captureCount: number, reclaimableBytes: number): HTMLButtonElement {
  const reclaimableSize = formatByteSize(reclaimableBytes);
  const vacuum = element("button", `Vacuum Vault · reclaim about ${reclaimableSize}`, "remove");
  vacuum.type = "button";
  vacuum.disabled = vaultMutationDisabled;
  vacuum.addEventListener("click", () => {
    if (
      !window.confirm(
        `Vacuum the Vault and permanently remove ${String(captureCount)} deleted ${captureCount === 1 ? "capture" : "captures"}, reclaiming about ${reclaimableSize}?\n\nThis rewrites local Vault history and has no undo. Old exports, backups, and offline copies are not removed.`,
      )
    )
      return;
    vacuum.disabled = true;
    libraryOperationError = undefined;
    if (announcer.textContent === "Vault Vacuum could not be completed safely.")
      announcer.textContent = "";
    void sendRequest<{
      readonly deletedCaptureCount: number;
      readonly reclaimedBytes: number;
    }>({ type: "VacuumVault", expectedVaultId: expectedVaultId() }).then(
      async (result) => {
        libraryOperationError = undefined;
        announcer.textContent = `Vault Vacuum removed ${String(result.deletedCaptureCount)} captures and reclaimed ${formatByteSize(result.reclaimedBytes)}`;
        await loadList("Deleted");
      },
      () => {
        libraryOperationError = "Vault Vacuum could not be completed safely.";
        reconcile();
      },
    );
  });
  return vacuum;
}

async function loadList(expandedSection?: "Active" | "Deleted"): Promise<void> {
  if (expandedSection !== undefined) expandedLibrarySection = expandedSection;
  releaseScreenshot();
  app.setAttribute("aria-busy", "true");
  try {
    const [loadedActiveGroups, loadedDeletedGroups, vacuumEstimate] = await Promise.all([
      sendRequest<readonly LibraryPageGroupMessage[]>({
        type: "ListLibrary",
        expectedVaultId: expectedVaultId(),
      }),
      sendRequest<readonly LibraryPageGroupMessage[]>({
        type: "ListDeleted",
        expectedVaultId: expectedVaultId(),
      }),
      sendRequest<{
        readonly deletedCaptureCount: number;
        readonly reclaimableBytes: number;
      }>({ type: "GetVacuumEstimate", expectedVaultId: expectedVaultId() }),
    ]);
    activeGroups = loadedActiveGroups;
    deletedGroups = loadedDeletedGroups;
    const content = document.createDocumentFragment();
    if (loadedActiveGroups.length === 0) {
      content.append(
        element("p", "No captures yet. Use the toolbar popup to archive a page.", "notice"),
      );
    } else {
      content.append(groupGrid(loadedActiveGroups, "Active"));
    }
    const deletedCount = loadedDeletedGroups.reduce(
      (total, group) => total + group.captures.length,
      0,
    );
    const deletedSection = element("details", undefined, "deleted-section") as HTMLDetailsElement;
    deletedSection.open = expandedLibrarySection === "Deleted";
    deletedSection.addEventListener("toggle", () => {
      expandedLibrarySection = deletedSection.open ? "Deleted" : "Active";
    });
    const deletedSummary = element(
      "summary",
      `Deleted (${String(deletedCount)})`,
      "deleted-section__summary",
    );
    const deletedContent = element("div", undefined, "deleted-section__content");
    if (loadedDeletedGroups.length === 0) {
      deletedContent.append(element("p", "Deleted is empty.", "notice"));
    } else {
      const reclaimableBytes = vacuumEstimate.reclaimableBytes;
      const reclaimableSize = formatByteSize(reclaimableBytes);
      deletedContent.append(
        element(
          "p",
          `${String(deletedCount)} deleted ${deletedCount === 1 ? "capture" : "captures"} · ${reclaimableSize} of encrypted Bundles retained · about ${reclaimableSize} reclaimable`,
          "muted",
        ),
        vacuumControl(deletedCount, reclaimableBytes),
        groupGrid(loadedDeletedGroups, "Deleted"),
      );
    }
    deletedSection.append(deletedSummary, deletedContent);
    content.append(deletedSection);
    app.replaceChildren(content);
    app.setAttribute("aria-busy", "false");
  } catch (error) {
    if (error instanceof AppClientError && error.id === "VAULT_CONTEXT_CHANGED") {
      await handleContextError(error);
      return;
    }
    if (error instanceof AppClientError && error.id === "VAULT_LOCKED") {
      await showUnlock();
      return;
    }
    if (error instanceof AppClientError && error.id === "BUNDLE_INVALID") {
      renderError("A Library record could not be authenticated. Recreate the development Vault.");
      return;
    }
    renderError("The Library could not be loaded. Close it and try again.");
  }
}

function renderGroup(group: LibraryPageGroupMessage): void {
  releaseScreenshot();
  const section = element("section", undefined, "history");
  const actions = element("div", undefined, "actions");
  const operation = group.latest.status === "Active" ? "Delete" : "Restore";
  const back = element("button", `← ${group.latest.status === "Active" ? "Library" : "Deleted"}`);
  back.addEventListener("click", () => void loadList(group.latest.status));
  const remove = element(
    "button",
    `${operation} collection`,
    operation === "Delete" ? "remove" : undefined,
  );
  remove.setAttribute("aria-label", `${operation} ${group.title} collection`);
  remove.disabled = vaultMutationDisabled;
  remove.addEventListener("click", () => confirmAndChangeGroup(group, remove, operation));
  actions.append(back, originalSiteLink(group));
  if (group.latest.status === "Active") {
    const merge = element("button", "Merge with…");
    merge.type = "button";
    merge.disabled = vaultMutationDisabled;
    merge.addEventListener("click", () => showMergePicker(group));
    actions.append(merge);
  }
  actions.append(remove);
  section.append(
    actions,
    element("h2", group.title),
    element(
      "p",
      `${String(group.captures.length)} ${group.captures.length === 1 ? "capture" : "captures"}`,
      "muted",
    ),
  );
  const knownAddresses = element("details", undefined, "known-addresses") as HTMLDetailsElement;
  knownAddresses.append(element("summary", `Known addresses (${String(group.knownUrls.length)})`));
  const addressList = element("ul");
  for (const url of group.knownUrls) addressList.append(element("li", url));
  knownAddresses.append(addressList);
  section.append(knownAddresses);
  const versions = element("div", undefined, "versions");
  const selected = new Set<string>();
  const selectionActions = element("div", undefined, "actions selection-actions");
  const moveSelected = element("button", "Move to collection…");
  const extractSelected = element("button", "Extract to new collection");
  moveSelected.disabled = true;
  extractSelected.disabled = true;
  const updateSelection = (): void => {
    moveSelected.disabled = vaultMutationDisabled || selected.size === 0;
    extractSelected.disabled = vaultMutationDisabled || selected.size === 0;
  };
  moveSelected.addEventListener("click", () => showMovePicker([...selected], group.collectionId));
  extractSelected.addEventListener("click", () => {
    const bundleIds = [...selected];
    if (bundleIds.length === 0) return;
    void applyManagement(
      {
        type: "ExtractCaptures",
        expectedVaultId: expectedVaultId(),
        bundleIds,
      },
      `Extracted ${String(bundleIds.length)} ${bundleIds.length === 1 ? "capture" : "captures"} to a new collection`,
    );
  });
  selectionActions.append(moveSelected, extractSelected);
  if (group.latest.status === "Active") section.append(selectionActions);
  for (const capture of group.captures) {
    const row = element("div", undefined, "version-row");
    if (group.latest.status === "Active") {
      row.draggable = true;
      const selectLabel = element("label", undefined, "version-select");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.disabled = vaultMutationDisabled;
      checkbox.setAttribute(
        "aria-label",
        `Select capture from ${new Date(capture.capturedAt).toLocaleString()}`,
      );
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(capture.bundleId);
        else selected.delete(capture.bundleId);
        updateSelection();
      });
      selectLabel.append(checkbox, element("span", "Select", "sr-only"));
      row.append(selectLabel);
      row.draggable = !vaultMutationDisabled;
      row.addEventListener("dragstart", (event) => {
        if (vaultMutationDisabled) return;
        useTiltedDragPreview(event, row);
        const bundleIds = selected.has(capture.bundleId) ? [...selected] : [capture.bundleId];
        event.dataTransfer?.setData("application/x-awsm-captures", JSON.stringify(bundleIds));
        if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        tray.hidden = false;
        announcer.textContent = `Dragging ${String(bundleIds.length)} ${bundleIds.length === 1 ? "capture" : "captures"}`;
      });
      row.addEventListener("dragend", () => {
        tray.hidden = true;
      });
    }
    const version = element("button", undefined, "version");
    version.type = "button";
    const thumbnail = thumbnailFor(group, capture.bundleId);
    if (thumbnail !== undefined) {
      version.append(
        thumbnailImage(
          thumbnail,
          `Screenshot thumbnail for ${capture.title}`,
          "version__thumbnail",
        ),
      );
    }
    version.append(
      element("strong", new Date(capture.capturedAt).toLocaleString()),
      element("span", capture.title, "muted"),
    );
    version.addEventListener("click", () => void loadDetail(capture.bundleId));
    row.append(version);
    versions.append(row);
  }
  section.append(versions);
  const tray = element("div", undefined, "drop-tray");
  tray.hidden = true;
  tray.append(element("strong", "Move captures to"));
  const addDropTarget = (label: string, destination: string | "new"): void => {
    const target = element("button", label, "drop-target");
    target.type = "button";
    target.disabled = vaultMutationDisabled;
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    });
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      const encoded = event.dataTransfer?.getData("application/x-awsm-captures");
      if (encoded === undefined || encoded === "") return;
      const parsed: unknown = JSON.parse(encoded);
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) return;
      const request = captureDropRequest(parsed, destination);
      if (request === undefined) return;
      void applyManagement(
        { ...request, expectedVaultId: expectedVaultId() },
        destination === "new"
          ? "Extracted captures to a new collection"
          : `Moved captures to ${label}`,
      );
    });
    tray.append(target);
  };
  for (const destination of activeGroups) {
    if (destination.collectionId !== group.collectionId) {
      addDropTarget(destination.title, destination.collectionId);
    }
  }
  addDropTarget("New collection", "new");
  if (group.latest.status === "Active") section.append(tray);
  app.replaceChildren(section);
  app.setAttribute("aria-busy", "false");
}

async function changeGroupState(
  group: LibraryPageGroupMessage,
  control: HTMLButtonElement,
  operation: "Delete" | "Restore",
): Promise<void> {
  control.disabled = true;
  try {
    await sendRequest<null>({
      type: operation === "Delete" ? "DeleteCaptures" : "RestoreCaptures",
      expectedVaultId: expectedVaultId(),
      bundleIds: group.captures.map((capture) => capture.bundleId),
    });
    announcer.textContent = `${operation === "Delete" ? "Deleted" : "Restored"} ${group.title}`;
    await loadList(group.latest.status);
  } catch {
    renderError("The Library entry could not be removed safely.");
  }
}

function confirmAndChangeGroup(
  group: LibraryPageGroupMessage,
  control: HTMLButtonElement,
  operation: "Delete" | "Restore",
): void {
  if (!window.confirm(libraryStateConfirmation(group.title, group.captures.length, operation)))
    return;
  void changeGroupState(group, control, operation);
}

async function showUnlock(): Promise<void> {
  try {
    const state = await sendRequest<AppState>({ type: "GetState" });
    renderVaultBar(state);
    const active = state.workspace.vaults.find((vault) => vault.active);
    if (active?.unlocked === true) {
      renderError("A library record could not be authenticated.");
      return;
    }
    const box = element("section", undefined, "notice");
    box.append(
      element("h2", "Unlock your Vault"),
      element("p", "Library metadata remains encrypted while locked."),
    );
    const device = element("button", "Unlock on this device");
    device.disabled = vaultManagementView(state.workspace).managementDisabled;
    device.addEventListener("click", () => {
      device.disabled = true;
      void sendRequest<AppState>({
        type: "UnlockDevice",
        expectedVaultId: expectedVaultId(),
      }).then(
        () => loadList(),
        () => renderError("The Vault could not be unlocked."),
      );
    });
    box.append(device);
    app.replaceChildren(box);
    app.setAttribute("aria-busy", "false");
  } catch {
    renderError("The local Vault could not be opened.");
  }
}

async function loadDetail(bundleId: string): Promise<void> {
  releaseScreenshot();
  const controller = new AbortController();
  detailController = controller;
  app.setAttribute("aria-busy", "true");
  try {
    const [detail, activeGroups, deletedGroups] = await Promise.all([
      sendRequest<LibraryDetailMessage>({
        type: "GetLibraryDetail",
        expectedVaultId: expectedVaultId(),
        bundleId,
      }),
      sendRequest<readonly LibraryPageGroupMessage[]>({
        type: "ListLibrary",
        expectedVaultId: expectedVaultId(),
      }),
      sendRequest<readonly LibraryPageGroupMessage[]>({
        type: "ListDeleted",
        expectedVaultId: expectedVaultId(),
      }),
    ]);
    const groups = [...activeGroups, ...deletedGroups];
    const group = groups.find((candidate) =>
      candidate.captures.some((capture) => capture.bundleId === bundleId),
    );
    if (group === undefined) throw new Error("The capture has no Library collection.");
    const section = element("article", undefined, "detail");
    const breadcrumb = element("nav", undefined, "breadcrumb");
    breadcrumb.setAttribute("aria-label", "Breadcrumb");
    const libraryCrumb = element(
      "button",
      detail.item.status === "Active" ? "Library" : "Deleted",
      "breadcrumb__link",
    );
    libraryCrumb.type = "button";
    libraryCrumb.addEventListener("click", () => void loadList(detail.item.status));
    breadcrumb.append(libraryCrumb);
    if (group.captures.length > 1) {
      breadcrumb.append(element("span", "/", "breadcrumb__separator"));
      const collectionCrumb = element("button", group.title, "breadcrumb__link");
      collectionCrumb.type = "button";
      collectionCrumb.addEventListener("click", () => renderGroup(group));
      breadcrumb.append(collectionCrumb);
    }
    breadcrumb.append(element("span", "/", "breadcrumb__separator"));
    const captureCrumb = element(
      "span",
      new Date(detail.item.capturedAt).toLocaleString(),
      "breadcrumb__current",
    );
    captureCrumb.setAttribute("aria-current", "page");
    breadcrumb.append(captureCrumb);
    const actions = element("div", undefined, "actions");
    const stateAction = element(
      "button",
      detail.item.status === "Active" ? "Delete capture" : "Restore capture",
      detail.item.status === "Active" ? "remove" : undefined,
    );
    stateAction.disabled = vaultMutationDisabled;
    stateAction.addEventListener("click", () => {
      const operation = detail.item.status === "Active" ? "Delete" : "Restore";
      if (!window.confirm(libraryStateConfirmation(detail.item.title, 1, operation))) return;
      stateAction.disabled = true;
      void sendRequest<null>({
        type: operation === "Delete" ? "DeleteCaptures" : "RestoreCaptures",
        expectedVaultId: expectedVaultId(),
        bundleIds: [detail.item.bundleId],
      }).then(
        () => loadList(detail.item.status),
        () => renderError("The capture state could not be changed safely."),
      );
    });
    actions.append(originalSiteLink(detail.item));
    if (detail.item.status === "Active") {
      const move = element("button", "Move to collection…");
      move.type = "button";
      move.disabled = vaultMutationDisabled;
      move.addEventListener("click", () =>
        showMovePicker([detail.item.bundleId], group.collectionId),
      );
      const extract = element("button", "Extract to new collection");
      extract.type = "button";
      extract.disabled = vaultMutationDisabled;
      extract.addEventListener("click", () => {
        void applyManagement(
          {
            type: "ExtractCaptures",
            expectedVaultId: expectedVaultId(),
            bundleIds: [detail.item.bundleId],
          },
          `Extracted ${detail.item.title} to a new collection`,
        );
      });
      actions.append(move, extract);
    }
    actions.append(stateAction);
    section.append(breadcrumb, actions, element("h2", detail.item.title));
    const metadata = element("dl", undefined, "metadata");
    const fields: readonly [string, string][] = [
      ["Original URL", detail.item.originalUrl],
      ["Captured", new Date(detail.item.capturedAt).toLocaleString()],
      ["Final URL", String(detail.metadata.finalUrl ?? "Unavailable")],
      ["Content type", String(detail.metadata.contentType ?? "Unavailable")],
    ];
    for (const [label, value] of fields)
      metadata.append(element("dt", label), element("dd", value));
    section.append(metadata);
    if (detail.item.warnings.length > 0)
      section.append(element("p", `Warnings: ${detail.item.warnings.join(", ")}`, "warning"));
    const artifactPanel = element("section", undefined, "artifact-panel");
    artifactPanel.setAttribute("aria-label", "Capture Artifacts");
    artifactPanel.append(element("h3", "Artifacts"));
    const inspection = element("section", undefined, "artifact-inspection");
    inspection.hidden = true;
    const bytesFromChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
      const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    };
    for (const artifact of detail.artifacts) {
      const row = element("article", undefined, "artifact-row");
      const summary = element("div", undefined, "artifact-row__summary");
      summary.append(
        element("strong", artifact.role.replaceAll("_", " ")),
        element("span", artifact.mimeType, "muted"),
        element(
          "span",
          artifact.byteLength === undefined
            ? artifact.state
            : `${artifact.state} · ${formatByteSize(artifact.byteLength)}`,
          artifact.state === "Failed" ? "warning" : "muted",
        ),
      );
      if (artifact.acquiredAt !== undefined)
        summary.append(
          element("span", `Acquired ${new Date(artifact.acquiredAt).toLocaleString()}`, "muted"),
        );
      if (artifact.warning !== undefined)
        summary.append(element("span", artifact.warning, "warning"));
      const rowActions = element("div", undefined, "artifact-row__actions");
      if (artifact.canInspect) {
        const inspect = element("button", "Inspect");
        inspect.type = "button";
        inspect.addEventListener("click", () => {
          inspect.disabled = true;
          inspection.hidden = false;
          inspection.replaceChildren(element("p", "Loading Artifact…", "muted"));
          const chunks: Uint8Array[] = [];
          void consumeArtifact(bundleId, artifact.role, controller.signal, (chunk) => {
            chunks.push(Uint8Array.from(chunk));
          }).then(
            () => {
              const bytes = bytesFromChunks(chunks);
              inspection.replaceChildren(element("h3", artifact.role.replaceAll("_", " ")));
              if (artifact.role === "TEXT_EXTRACTED") {
                inspection.append(element("pre", new TextDecoder().decode(bytes)));
              } else {
                const appendTextAndLinks = (
                  container: HTMLElement,
                  text: string,
                  links: readonly {
                    readonly href: string;
                    readonly text: string;
                  }[],
                ): void => {
                  container.append(document.createTextNode(text));
                  if (links.length === 0) return;
                  const linkList = element("span", undefined, "artifact-inspection__links");
                  linkList.append(document.createTextNode(" Links: "));
                  links.forEach((link, index) => {
                    const anchor = element("a", link.text || link.href);
                    anchor.href = link.href;
                    anchor.target = "_blank";
                    anchor.rel = "noopener noreferrer";
                    if (index > 0) linkList.append(document.createTextNode(", "));
                    linkList.append(anchor);
                  });
                  container.append(linkList);
                };
                for (const block of decodeStructuredContentSequence(bytes)) {
                  if (block.kind === "Heading") {
                    const headingTags = ["h3", "h4", "h5", "h6", "h6", "h6"] as const;
                    const heading = element(headingTags[block.level - 1] ?? "h6", block.text);
                    appendTextAndLinks(heading, "", block.links);
                    inspection.append(heading);
                  } else if (block.kind === "Preformatted")
                    inspection.append(element("pre", block.text));
                  else if (block.kind === "Table") {
                    const table = element("table");
                    for (const cells of block.rows) {
                      const tr = element("tr");
                      for (const cell of cells) tr.append(element("td", cell));
                      table.append(tr);
                    }
                    inspection.append(table);
                  } else if (block.kind === "Quote") {
                    const quote = element("blockquote");
                    appendTextAndLinks(quote, block.text, block.links);
                    inspection.append(quote);
                  } else if (block.kind === "ListItem") {
                    const list = element(block.ordered ? "ol" : "ul");
                    list.style.marginInlineStart = `${String(Math.min(block.depth, 8) * 1.25)}rem`;
                    const item = element("li");
                    appendTextAndLinks(item, block.text, block.links);
                    list.append(item);
                    inspection.append(list);
                  } else {
                    const paragraph = element("p");
                    appendTextAndLinks(paragraph, block.text, block.links);
                    inspection.append(paragraph);
                  }
                }
              }
              inspect.disabled = false;
            },
            () => {
              inspection.replaceChildren(
                element("p", "The Artifact could not be inspected.", "notice error"),
              );
              inspect.disabled = false;
            },
          );
        });
        rowActions.append(inspect);
      }
      if (artifact.canDownload) {
        const download = element("button", "Download");
        download.type = "button";
        download.addEventListener("click", () => {
          download.disabled = true;
          void downloadArtifact(bundleId, artifact.role, controller.signal).then(
            () => {
              download.disabled = false;
            },
            () => {
              download.disabled = false;
              announcer.textContent = "The Artifact could not be saved.";
            },
          );
        });
        rowActions.append(download);
      }
      row.append(summary, rowActions);
      artifactPanel.append(row);
    }
    section.append(artifactPanel, inspection);
    const screenshot = detail.artifacts.find(
      (artifact) => artifact.role === "SCREENSHOT_FULL" && artifact.state === "Present",
    );
    if (screenshot !== undefined) {
      const preview = element("section", undefined, "artifact-preview");
      preview.setAttribute("aria-label", "Full screenshot preview");
      preview.append(element("p", "Loading screenshot…", "muted"));
      section.append(preview);
      const chunks: Uint8Array[] = [];
      void consumeArtifact(bundleId, "SCREENSHOT_FULL", controller.signal, (chunk) => {
        chunks.push(Uint8Array.from(chunk));
      }).then(
        () => {
          if (controller.signal.aborted) return;
          screenshotUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(bytesFromChunks(chunks)).buffer], {
              type: "image/webp",
            }),
          );
          const image = element("img");
          image.src = screenshotUrl;
          image.alt = `Full-page screenshot of ${detail.item.title}`;
          preview.replaceChildren(image);
        },
        () => preview.replaceChildren(element("p", "Screenshot preview unavailable.", "warning")),
      );
    }
    app.replaceChildren(section);
    app.setAttribute("aria-busy", "false");
    announcer.textContent = `Opened ${detail.item.title}`;
  } catch (error) {
    if (error instanceof AppClientError && error.id === "VAULT_CONTEXT_CHANGED") {
      await handleContextError(error);
      return;
    }
    renderError("This capture is missing or corrupt. No partial content was opened.");
  }
}

window.addEventListener("pagehide", releaseScreenshot);
window.addEventListener("pagehide", () => cancelPageOwnedImport?.());
const requestedBundleId = new URLSearchParams(window.location.search).get("bundleId");
const requestedVaultId = new URLSearchParams(window.location.search).get("vaultId");

async function initialize(): Promise<void> {
  try {
    const state = await sendRequest<AppState>({ type: "GetState" });
    if (
      pageOwnedImportJobId !== undefined &&
      state.latestImportJob?.jobId === pageOwnedImportJobId &&
      state.latestImportJob.state === "Cancelled"
    ) {
      abortPageOwnedImport?.();
      closePageOwnedImport?.();
    }
    renderVaultBar(state);
    const active = state.workspace.vaults.find((vault) => vault.active);
    if (active === undefined) {
      const create = element("button", "Create new Vault");
      create.addEventListener("click", () => void showCreateVaultDialog(create));
      const importExisting = element("button", "Import existing Vault");
      importExisting.dataset.importVault = "true";
      importExisting.addEventListener("click", () => showImportVaultDialog(importExisting));
      const actions = element("div", undefined, "actions");
      actions.append(create, importExisting);
      app.replaceChildren(
        element("h2", "Create or import your first Vault"),
        element("p", "Start a new encrypted local Vault or import an encrypted AWSM package."),
        actions,
      );
      app.setAttribute("aria-busy", "false");
      if (!importRouteOpened && new URLSearchParams(window.location.search).get("import") === "1") {
        importRouteOpened = true;
        showImportVaultDialog(importExisting);
      }
      return;
    }
    if (!importRouteOpened && new URLSearchParams(window.location.search).get("import") === "1") {
      importRouteOpened = true;
      const trigger = document.querySelector<HTMLElement>("[data-import-vault='true']");
      if (trigger !== null) showImportVaultDialog(trigger);
    }
    if (requestedVaultId !== null) {
      const route = deepLinkVaultRoute(state.workspace.activeVaultId, requestedVaultId);
      if (route.route === "switch-prompt") {
        const target = state.workspace.vaults.find(
          (vault) => vault.vaultId === route.targetVaultId,
        );
        const box = element("section", undefined, "notice");
        box.append(
          element("h2", `Switch to ${target?.name ?? `Vault ${route.targetVaultId.slice(-6)}`}?`),
          element("p", "This link belongs to another Vault. Switching locks the current Vault."),
        );
        const select = element("button", "Switch to this Vault");
        select.addEventListener("click", () => {
          select.disabled = true;
          void sendRequest<AppState>({
            type: "SelectActiveVault",
            expectedActiveVaultId: active.vaultId,
            vaultId: route.targetVaultId,
          }).then(
            (next) => {
              renderVaultBar(next);
              announcer.textContent = "Vault selected. Unlock it to open this capture.";
              void showUnlock();
            },
            (error) => void handleContextError(error),
          );
        });
        box.append(select);
        app.replaceChildren(box);
        app.setAttribute("aria-busy", "false");
        return;
      }
    }
    if (!active.unlocked) {
      await showUnlock();
      return;
    }
    if (
      !staleRecoveryDialogOpened &&
      state.account.staleResolutionRequired === true &&
      new URLSearchParams(window.location.search).get("resolveStale") === "1"
    ) {
      staleRecoveryDialogOpened = true;
      const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Resolve stale Vault",
      );
      if (trigger !== undefined) showStaleReplicaRecoveryDialog(trigger);
    }
    if (requestedBundleId === null) await loadList();
    else await loadDetail(requestedBundleId);
    if (libraryOperationError !== undefined) announcer.textContent = libraryOperationError;
  } catch (error) {
    renderError(
      error instanceof AppClientError ? error.message : "The local Vault could not be opened.",
    );
  }
}

let reconciliationRequested = false;
let reconciliationRunning = false;

function reconcile(): void {
  reconciliationRequested = true;
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  void (async () => {
    while (reconciliationRequested) {
      reconciliationRequested = false;
      await initialize();
    }
  })().finally(() => {
    reconciliationRunning = false;
    if (reconciliationRequested) reconcile();
  });
}

function wakeSynchronization(): void {
  void sendRequest<AppState>({ type: "WakeSynchronization" }).catch(() => undefined);
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "AppStateChanged"
  ) {
    releaseScreenshot();
    activeGroups = [];
    deletedGroups = [];
    editingVaultId = undefined;
    app.replaceChildren(element("p", "Refreshing Vault state…", "muted"));
    app.setAttribute("aria-busy", "true");
    announcer.textContent = "Vault state changed. Library data is refreshing.";
    reconcile();
  }
  return undefined;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    wakeSynchronization();
    reconcile();
  }
});
window.addEventListener("focus", () => {
  wakeSynchronization();
  reconcile();
});
window.addEventListener("online", wakeSynchronization);

wakeSynchronization();
reconcile();
