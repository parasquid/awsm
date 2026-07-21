import { browser } from "wxt/browser";
import { AppClientError, sendRequest } from "../../src/app/client";
import type { AppState } from "../../src/app/protocol";
import { serverPermissionPattern } from "../../src/runtime/account/server";

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (node === null) throw new Error("Signup shell is incomplete.");
  return node;
}

const form = required<HTMLFormElement>("#signup-form");
const serverChoice = required<HTMLElement>("#server-choice");
const hostedServer = required<HTMLButtonElement>("#hosted-server");
const serverForm = required<HTMLFormElement>("#server-form");
const serverOrigin = required<HTMLInputElement>('input[name="server-origin"]');
const choices = required<HTMLFieldSetElement>("#vault-choice");
const status = required<HTMLElement>("#status");
const vaultNameLabel = required<HTMLLabelElement>("#new-vault-name");
const vaultNameInput = required<HTMLInputElement>('input[name="vault-name"]');
const passwordInput = required<HTMLInputElement>('input[name="password"]');
const confirmationInput = required<HTMLInputElement>('input[name="confirmation"]');
let completionMode = false;

function showStatus(message: string, role: "status" | "alert" = "status"): void {
  status.setAttribute("role", role);
  status.textContent = message;
}

async function configureServer(origin: string): Promise<void> {
  if (
    !(await browser.permissions.request({
      origins: [serverPermissionPattern(origin)],
    }))
  ) {
    throw new AppClientError(
      "SERVER_PERMISSION_DENIED",
      "Chrome did not grant access to that synchronization server.",
    );
  }
  await sendRequest<AppState>({
    type: "ConfigureSyncServer",
    serverOrigin: origin,
  });
  await initialize();
}

function updateVaultNameRequirement(): void {
  const selected = form.querySelector<HTMLInputElement>('input[name="vault-choice"]:checked');
  const creating = selected?.value === "new";
  vaultNameLabel.hidden = !creating;
  vaultNameInput.required = creating;
}

function choice(value: string, labelText: string, checked = false): HTMLLabelElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "vault-choice";
  input.value = value;
  input.required = true;
  input.checked = checked;
  input.addEventListener("change", updateVaultNameRequirement);
  label.append(input, document.createTextNode(labelText));
  return label;
}

async function initialize(): Promise<void> {
  const state = await sendRequest<AppState>({ type: "GetState" });
  if (state.account.configuration.mode === "Unconfigured") {
    required<HTMLHeadingElement>("h1").textContent = "Choose synchronization";
    serverChoice.hidden = false;
    form.hidden = true;
    return;
  }
  required<HTMLHeadingElement>("h1").textContent = "Create your Account";
  showStatus("");
  serverChoice.hidden = true;
  form.hidden = false;
  completionMode =
    state.account.accountState === "Authenticated" &&
    state.account.vaultSyncState === "SetupRequired";
  if (completionMode) {
    for (const name of ["email", "password", "confirmation", "acknowledgement"]) {
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLInputElement) {
        input.required = false;
        input.disabled = true;
        input.closest("label")?.setAttribute("hidden", "");
      }
    }
    required<HTMLHeadingElement>("h1").textContent = "Finish Account setup";
  }
  choices.replaceChildren(document.createElement("legend"));
  const legend = choices.querySelector("legend");
  if (legend !== null) legend.textContent = "Vault to synchronize";
  choices.append(choice("new", "Create a new Vault", true));
  for (const vault of state.workspace.vaults) {
    choices.append(choice(vault.vaultId, `Use and unlock existing local Vault: ${vault.name}`));
  }
  const suggestion = await sendRequest<{ readonly name: string }>({
    type: "SuggestVaultName",
  });
  vaultNameInput.value = suggestion.name;
  updateVaultNameRequirement();
}

hostedServer.addEventListener("click", () => {
  hostedServer.disabled = true;
  showStatus("Connecting to hosted AWSM…");
  void configureServer("https://awsm.foo").catch((cause: unknown) => {
    hostedServer.disabled = false;
    showStatus(
      cause instanceof AppClientError
        ? cause.message
        : "The synchronization server could not be configured.",
      "alert",
    );
  });
});

serverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submit = required<HTMLButtonElement>('#server-form button[type="submit"]');
  submit.disabled = true;
  showStatus("Connecting to the synchronization server…");
  void configureServer(serverOrigin.value).catch((cause: unknown) => {
    submit.disabled = false;
    showStatus(
      cause instanceof AppClientError
        ? cause.message
        : "The synchronization server could not be configured.",
      "alert",
    );
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  const confirmation = String(data.get("confirmation") ?? "");
  if (!completionMode && password !== confirmation) {
    showStatus("Passwords do not match.", "alert");
    return;
  }
  const selected = String(data.get("vault-choice") ?? "");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit !== null) submit.disabled = true;
  showStatus(
    completionMode
      ? "Preparing synchronization…"
      : "Creating Account and preparing synchronization…",
  );
  const vaultChoice =
    selected === "new"
      ? { newVaultName: String(data.get("vault-name") ?? "") }
      : { existingVaultId: selected };
  const pending = completionMode
    ? sendRequest<AppState>({ type: "CompleteAccountVault", ...vaultChoice })
    : sendRequest<AppState>({
        type: "SignupAccount",
        email: String(data.get("email") ?? ""),
        password,
        recoveryAcknowledged: true,
        ...vaultChoice,
      });
  passwordInput.value = "";
  confirmationInput.value = "";
  void pending.then(
    () => {
      showStatus(
        completionMode
          ? "Synchronization setup complete. Returning to your page…"
          : "Account created. Returning to your page…",
      );
      form.hidden = true;
      window.setTimeout(() => window.close(), 750);
    },
    () => {
      showStatus(
        "The Account could not be created safely. Review your details and retry.",
        "alert",
      );
      if (submit !== null) submit.disabled = false;
    },
  );
});

void initialize().catch(() => {
  showStatus("Local Vault choices could not be loaded.", "alert");
});
