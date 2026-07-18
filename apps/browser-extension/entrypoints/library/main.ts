import { base64ToBytes } from "../../src/app/base64";
import { AppClientError, sendRequest } from "../../src/app/client";
import type {
  AppRequestV1,
  AppStateV1,
  LibraryDetailMessageV1,
  LibraryOperationReceiptV1,
  LibraryPageGroupMessageV1,
} from "../../src/app/protocol";
import {
  captureDropRequest,
  collectionLayerBundleIds,
  dragImageHotspot,
  formatByteSize,
  libraryGroupDestination,
  libraryStateConfirmation,
  mergeDropRequest,
} from "../../src/ui/library-view";

function requiredElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error("Library shell is incomplete.");
  return node;
}

const app = requiredElement("#app");
const announcer = requiredElement("#announcer");
let screenshotUrl: string | undefined;
let activeGroups: readonly LibraryPageGroupMessageV1[] = [];
let deletedGroups: readonly LibraryPageGroupMessageV1[] = [];
let undoTimer: number | undefined;
let undoNotice: HTMLElement | undefined;
let draggedCollectionId: string | undefined;

type ManagementRequest = Extract<
  AppRequestV1,
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
  if (screenshotUrl !== undefined) URL.revokeObjectURL(screenshotUrl);
  screenshotUrl = undefined;
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

function showUndoNotice(message: string, receipt: LibraryOperationReceiptV1): void {
  clearUndoNotice();
  const notice = element("div", undefined, "snackbar");
  notice.setAttribute("role", "status");
  notice.append(element("span", message));
  const undo = element("button", "Undo");
  undo.type = "button";
  undo.addEventListener("click", () => {
    undo.disabled = true;
    void sendRequest<LibraryOperationReceiptV1>({
      version: 1,
      type: "UndoLibraryOperation",
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
    const receipt = await sendRequest<LibraryOperationReceiptV1>(request);
    await loadList();
    announcer.textContent = message;
    showUndoNotice(message, receipt);
  } catch (error) {
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
  form.append(element("h2", title));
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return { dialog, form };
}

function showMergePicker(destination: LibraryPageGroupMessageV1): void {
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
        version: 1,
        type: "MergeCollections",
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
      { version: 1, type: "MoveCaptures", bundleIds, destinationCollectionId: destination },
      `Moved ${String(bundleIds.length)} ${bundleIds.length === 1 ? "capture" : "captures"}`,
    );
  });
  dialog.showModal();
}

function thumbnailFor(group: LibraryPageGroupMessageV1, bundleId: string): string | undefined {
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

function collectionPreview(group: LibraryPageGroupMessageV1): HTMLElement | undefined {
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
  groups: readonly LibraryPageGroupMessageV1[],
  status: "Active" | "Deleted",
): HTMLElement {
  const grid = element("div", undefined, "grid");
  for (const group of groups) {
    const wrapper = element("article", undefined, "library-card");
    if (status === "Active") {
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
        void applyManagement(request, `Merged a collection into ${group.title}`);
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
    if (!group.latest.screenshotPresent)
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
  vacuum.addEventListener("click", () => {
    if (
      !window.confirm(
        `Vacuum the Vault and permanently remove ${String(captureCount)} deleted ${captureCount === 1 ? "capture" : "captures"}, reclaiming about ${reclaimableSize}?\n\nThis rewrites local Vault history and has no undo. Old exports, backups, and offline copies are not removed.`,
      )
    )
      return;
    vacuum.disabled = true;
    void sendRequest<{
      readonly version: 1;
      readonly deletedCaptureCount: number;
      readonly reclaimedBytes: number;
    }>({ version: 1, type: "VacuumVault" }).then(
      async (result) => {
        announcer.textContent = `Vault Vacuum removed ${String(result.deletedCaptureCount)} captures and reclaimed ${formatByteSize(result.reclaimedBytes)}`;
        await loadList("Deleted");
      },
      () => renderError("Vault Vacuum could not be completed safely."),
    );
  });
  return vacuum;
}

async function loadList(expandedSection: "Active" | "Deleted" = "Active"): Promise<void> {
  releaseScreenshot();
  app.setAttribute("aria-busy", "true");
  try {
    const [loadedActiveGroups, loadedDeletedGroups, vacuumEstimate] = await Promise.all([
      sendRequest<readonly LibraryPageGroupMessageV1[]>({ version: 1, type: "ListLibrary" }),
      sendRequest<readonly LibraryPageGroupMessageV1[]>({ version: 1, type: "ListDeleted" }),
      sendRequest<{
        readonly version: 1;
        readonly deletedCaptureCount: number;
        readonly reclaimableBytes: number;
      }>({ version: 1, type: "GetVacuumEstimate" }),
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
    deletedSection.open = expandedSection === "Deleted";
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

function renderGroup(group: LibraryPageGroupMessageV1): void {
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
  remove.addEventListener("click", () => confirmAndChangeGroup(group, remove, operation));
  actions.append(back, originalSiteLink(group));
  if (group.latest.status === "Active") {
    const merge = element("button", "Merge with…");
    merge.type = "button";
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
    moveSelected.disabled = selected.size === 0;
    extractSelected.disabled = selected.size === 0;
  };
  moveSelected.addEventListener("click", () => showMovePicker([...selected], group.collectionId));
  extractSelected.addEventListener("click", () => {
    const bundleIds = [...selected];
    if (bundleIds.length === 0) return;
    void applyManagement(
      { version: 1, type: "ExtractCaptures", bundleIds },
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
      row.addEventListener("dragstart", (event) => {
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
        request,
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
  group: LibraryPageGroupMessageV1,
  control: HTMLButtonElement,
  operation: "Delete" | "Restore",
): Promise<void> {
  control.disabled = true;
  try {
    await sendRequest<null>({
      version: 1,
      type: operation === "Delete" ? "DeleteCaptures" : "RestoreCaptures",
      bundleIds: group.captures.map((capture) => capture.bundleId),
    });
    announcer.textContent = `${operation === "Delete" ? "Deleted" : "Restored"} ${group.title}`;
    await loadList(group.latest.status);
  } catch {
    renderError("The Library entry could not be removed safely.");
  }
}

function confirmAndChangeGroup(
  group: LibraryPageGroupMessageV1,
  control: HTMLButtonElement,
  operation: "Delete" | "Restore",
): void {
  if (!window.confirm(libraryStateConfirmation(group.title, group.captures.length, operation)))
    return;
  void changeGroupState(group, control, operation);
}

async function showUnlock(): Promise<void> {
  try {
    const state = await sendRequest<AppStateV1>({ version: 1, type: "GetState" });
    if (state.unlocked) {
      renderError("A library record could not be authenticated.");
      return;
    }
    const box = element("section", undefined, "notice");
    box.append(
      element("h2", "Unlock your Vault"),
      element("p", "Library metadata remains encrypted while locked."),
    );
    const device = element("button", "Unlock on this device");
    device.addEventListener("click", () => {
      device.disabled = true;
      void sendRequest<AppStateV1>({ version: 1, type: "UnlockDevice" }).then(
        () => loadList(),
        () => renderError("The Vault could not be unlocked."),
      );
    });
    box.append(device);
    if (state.hasPassphraseSlot) {
      const form = element("form");
      const label = element("label", "Passphrase");
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
          () => loadList(),
          () => renderError("The Vault could not be unlocked."),
        );
      });
      box.append(form);
    }
    app.replaceChildren(box);
    app.setAttribute("aria-busy", "false");
  } catch {
    renderError("The local Vault could not be opened.");
  }
}

async function loadDetail(bundleId: string): Promise<void> {
  releaseScreenshot();
  app.setAttribute("aria-busy", "true");
  try {
    const [detail, activeGroups, deletedGroups] = await Promise.all([
      sendRequest<LibraryDetailMessageV1>({
        version: 1,
        type: "GetLibraryDetail",
        bundleId,
      }),
      sendRequest<readonly LibraryPageGroupMessageV1[]>({ version: 1, type: "ListLibrary" }),
      sendRequest<readonly LibraryPageGroupMessageV1[]>({ version: 1, type: "ListDeleted" }),
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
    const mhtmlBlob = new Blob([Uint8Array.from(base64ToBytes(detail.mhtmlBase64)).buffer], {
      type: "multipart/related",
    });
    const mhtmlUrl = URL.createObjectURL(mhtmlBlob);
    const download = element("a", "Download archived MHTML", "download");
    download.href = mhtmlUrl;
    download.download = `awsm-${detail.item.bundleId}.mhtml`;
    download.addEventListener(
      "click",
      () => window.setTimeout(() => URL.revokeObjectURL(mhtmlUrl), 1_000),
      { once: true },
    );
    const stateAction = element(
      "button",
      detail.item.status === "Active" ? "Delete capture" : "Restore capture",
      detail.item.status === "Active" ? "remove" : undefined,
    );
    stateAction.addEventListener("click", () => {
      const operation = detail.item.status === "Active" ? "Delete" : "Restore";
      if (!window.confirm(libraryStateConfirmation(detail.item.title, 1, operation))) return;
      stateAction.disabled = true;
      void sendRequest<null>({
        version: 1,
        type: operation === "Delete" ? "DeleteCaptures" : "RestoreCaptures",
        bundleIds: [detail.item.bundleId],
      }).then(
        () => loadList(detail.item.status),
        () => renderError("The capture state could not be changed safely."),
      );
    });
    actions.append(originalSiteLink(detail.item), download);
    if (detail.item.status === "Active") {
      const move = element("button", "Move to collection…");
      move.type = "button";
      move.addEventListener("click", () =>
        showMovePicker([detail.item.bundleId], group.collectionId),
      );
      const extract = element("button", "Extract to new collection");
      extract.type = "button";
      extract.addEventListener("click", () => {
        void applyManagement(
          { version: 1, type: "ExtractCaptures", bundleIds: [detail.item.bundleId] },
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
    if (detail.screenshotBase64 !== undefined) {
      screenshotUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(base64ToBytes(detail.screenshotBase64)).buffer], {
          type: "image/webp",
        }),
      );
      const image = element("img");
      image.src = screenshotUrl;
      image.alt = `Full-page screenshot of ${detail.item.title}`;
      section.append(image);
    } else {
      section.append(
        element("p", "No screenshot was available; the mandatory MHTML is preserved.", "warning"),
      );
    }
    app.replaceChildren(section);
    app.setAttribute("aria-busy", "false");
    announcer.textContent = `Opened ${detail.item.title}`;
  } catch {
    renderError("This capture is missing or corrupt. No partial content was opened.");
  }
}

window.addEventListener("pagehide", releaseScreenshot);
const requestedBundleId = new URLSearchParams(window.location.search).get("bundleId");
if (requestedBundleId === null) void loadList();
else void loadDetail(requestedBundleId);
