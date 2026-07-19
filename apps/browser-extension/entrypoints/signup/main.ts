import { sendRequest } from "../../src/app/client";
import type { AppState } from "../../src/app/protocol";

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (node === null) throw new Error("Signup shell is incomplete.");
  return node;
}

const form = required<HTMLFormElement>("#signup-form");
const choices = required<HTMLFieldSetElement>("#vault-choice");
const status = required<HTMLElement>("#status");
const vaultNameLabel = required<HTMLLabelElement>("#new-vault-name");
const vaultNameInput = required<HTMLInputElement>('input[name="vault-name"]');
let completionMode = false;

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
  const suggestion = await sendRequest<{ readonly name: string }>({ type: "SuggestVaultName" });
  vaultNameInput.value = suggestion.name;
  updateVaultNameRequirement();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  const confirmation = String(data.get("confirmation") ?? "");
  if (!completionMode && password !== confirmation) {
    status.setAttribute("role", "alert");
    status.textContent = "Passwords do not match.";
    return;
  }
  const selected = String(data.get("vault-choice") ?? "");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit !== null) submit.disabled = true;
  status.setAttribute("role", "status");
  status.textContent = completionMode
    ? "Preparing synchronization…"
    : "Creating Account and preparing synchronization…";
  const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
  const confirmationInput = form.elements.namedItem("confirmation") as HTMLInputElement;
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
      status.textContent = completionMode
        ? "Synchronization setup complete. You may close this tab."
        : "Account created. You may close this tab.";
      form.hidden = true;
    },
    () => {
      status.setAttribute("role", "alert");
      status.textContent =
        "The Account could not be created safely. Review your details and retry.";
      if (submit !== null) submit.disabled = false;
    },
  );
});

void initialize().catch(() => {
  status.setAttribute("role", "alert");
  status.textContent = "Local Vault choices could not be loaded.";
});
