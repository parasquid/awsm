# Multiple Vault Management

**Document:** `docs/plans/03-multiple-vault-management.md`

**Status:** Approved implementation plan

**Owner:** Engineering

**Last Updated:** 2026-07-18

**Depends On:** the architecture, specifications, and product documents reconciled by this plan

---

# 1. Purpose

This is the decision-complete implementation plan for adding multiple local Vaults to the AWSM browser extension.

The implementer is expected to begin from a cold checkout with no prior conversation context. Do not reopen decisions recorded here. When a Draft document conflicts with this plan, this plan wins and every affected document must be reconciled in the same change.

The completed feature lets a user:

1. create more than one cryptographically independent Vault;
2. see the active Vault in both the popup and Library;
3. switch the global active Vault;
4. use the selected Vault as the destination for every subsequent Capture;
5. give each Vault an independent non-exportable local device slot;
6. accept or edit a generated preservation-themed name during creation;
7. rename an unlocked Vault after creation; and
8. continue seeing Vault names in the picker while Vault contents are locked.

This plan does not implement Vault deletion, cross-Vault movement, sharing, synchronization, Import, Export, Backup, Restore, or additional key-management controls.

---

# 2. Mandatory TDD Protocol

Implement every task through RED-GREEN-REFACTOR:

1. **RED:** add the smallest test for the next externally observable behavior.
2. Run the focused test and confirm it fails for the expected missing behavior.
3. **GREEN:** add only enough production code to pass.
4. Run the focused test until it passes.
5. **REFACTOR:** improve structure without expanding behavior.
6. Run the focused test and then the complete affected suite.

Rules:

- Production behavior must not precede its failing test.
- Do not weaken, delete, skip, or rewrite tests merely to obtain green.
- Every defect found during implementation first receives a failing regression test.
- Exercise storage boundaries with real IndexedDB browser integration tests, not only memory fakes.
- Exercise user workflows through the packaged Chrome extension before declaring completion.
- Record RED and GREEN evidence in implementation notes or a companion evidence document.

---

# 3. Canonical Implementation Boundaries

- `src/app/background.ts` owns one Workspace context manager rather than an unscoped Driver or
  Vault Service.
- Every Vault repository and Driver operation requires an explicit Vault identity.
- Every IndexedDB Object, Event, Projection, Job, outcome, generation, head, and Vacuum lease uses
  a Vault-prefixed key.
- Application state exposes the Workspace directory and its one device-local Active Vault.
- Every Vault-scoped application request carries the caller's expected Vault identity.
- Capture Jobs identify their Vault.
- Popup and Library render and mutate the same Workspace selection.
- Vault names are encrypted, Event-derived state with an encrypted rebuildable Workspace cache.

---

# 4. Fixed Product Decisions

## 4.1 Global active Vault

- A Workspace manages one or more independent Vaults.
- One device-local `activeVaultId` is shared by the popup, Library, and background Runtime.
- Selecting a Vault anywhere changes the active Vault everywhere.
- The active selection is local operational state. It is not authoritative Vault history and never synchronizes.
- Every new Capture targets the active Vault at Command acceptance time.
- Open UI surfaces must refresh when another surface changes the active Vault.

## 4.2 Switching and locking

- Switching manually locks the previous Vault.
- The previous Vault Root Key is discarded from Runtime memory after the switch transaction commits.
- The selected target becomes active but remains locked until the user explicitly chooses a supported unlock action.
- Switching must not implicitly unwrap the target device slot.
- If switching fails, the previous Vault remains selected and retains its prior in-memory unlock state.
- Creating a Vault is the exception: after an atomic successful creation, the old Vault is locked and the new Vault is active and unlocked.
- A Runtime restart may continue the existing auto-unlock behavior only for the active Vault when its `manuallyLocked` flag is false.
- Inactive Vaults must always be persisted as manually locked.

## 4.3 Busy behavior

- Disable Create, Switch, and Rename while a Capture or Vault Vacuum is running for the active Vault.
- The Runtime must also reject raced management requests with a stable error; disabled UI is not a correctness boundary.
- Capture progress must state the destination Vault name.
- An accepted Capture remains pinned to its starting Vault even if a stale UI attempts a concurrent switch.

## 4.4 Surfaces

- Both the popup and Library display the active Vault name and lock state.
- Both surfaces expose a keyboard-accessible Vault picker.
- Rename is a Library-only interaction defined by the approved
  `04-library-centered-vault-rename.md` plan. The capture popup does not expose Rename.
- The picker contains `Create new Vault`.
- Switching is immediately reversible through unlock and does not require an additional confirmation dialog. The picker must explain that switching locks the current Vault.

## 4.5 Creation and passphrases

- Initial onboarding and subsequent creation use the same name and passphrase behavior.
- The Runtime supplies a generated name before form submission.
- The generated name is prefilled and editable.
- Each Vault independently owns its local device slot and has no persistent passphrase credential.
- Never copy, inherit, reuse, or prefill a passphrase from another Vault.
- Successful creation makes the new Vault active and unlocked.

## 4.6 Names

- A Vault name is private authoritative Vault state.
- The initial name is recorded by `VaultCreated`.
- Later names are recorded by `VaultRenamed`.
- Names synchronize in the future only as encrypted Vault Events.
- Names are labels, not identifiers. Vault ID remains the only identity.
- Duplicate user-selected names are allowed.
- When normalized names collide in the local Workspace, UI summaries show creation date and the final six Vault ID characters.
- Renaming requires the Vault to be active and unlocked.

---

# 5. Canonical Terminology and Invariants

Update the glossary to define:

- **Workspace:** a management context that enumerates one or more independent Vaults without combining their ownership, authority, cryptographic material, synchronization state, or storage identity.
- **Active Vault:** the one device-local Vault context selected for new Commands and UI operations. Active selection is operational state, not a synchronized Event-derived fact.

Preserve these invariants:

1. Every authoritative Object and Event belongs to exactly one Vault.
2. A Vault Root Key is never reused across Vaults.
3. An Object ID never migrates between Vaults.
4. No read, write, enumeration, Projection rebuild, Job recovery, or Vacuum operation crosses a Vault key prefix.
5. Active selection never creates a Vault Event.
6. Create and Rename produce immutable encrypted Events.
7. Vault names remain opaque outside trusted clients.
8. A local name cache is rebuildable and never authoritative.
9. A stale UI cannot cause a Command intended for one Vault to execute against another.
10. Failure during create, switch, or rename exposes either the complete predecessor state or the complete successor state, never a partial combination.

---

# 6. Name Contract

## 6.1 Validation and normalization

Use one Runtime-owned `normalizeVaultName` function for generated names, Create, Rename, Event decoding, Projection replay, and UI error handling.

The function must:

1. normalize input to Unicode NFC;
2. trim leading and trailing Unicode whitespace;
3. collapse every internal run of whitespace to one ASCII space;
4. require between 1 and 64 Unicode code points after normalization;
5. reject line separators, C0/C1 controls, and bidi override/isolate controls; and
6. return the canonical normalized string used in Events and Projections.

Do not silently truncate a name. Invalid Create or Rename Commands produce `INVALID_VAULT_NAME` and no Event or state change.

Duplicate detection for display uses the normalized name with locale-independent Unicode case folding. Duplicate detection affects only disambiguating UI text; it never rejects a Command or changes the stored name.

## 6.2 Generated names

- Add versioned, bundled preservation-themed adjective and noun lists.
- Format suggestions as Title Case two-word names such as `Amber Chronicle`, `Quiet Folio`, or `Starlit Archive`.
- Select words with `crypto.getRandomValues`; do not use `Math.random`.
- Do not derive words from browsing history, page content, user data, time, locale, or identifiers.
- Avoid a case-folded collision with a local Vault name by retrying from the word lists.
- After 32 unsuccessful attempts, append the smallest positive decimal suffix that produces an unused display name, for example `Amber Chronicle 2`.
- The suggestion is not persisted and creates no Event until submitted through Create.

---

# 7. Public Runtime and Application Contracts

Replace the pre-release application message contract in place. Application requests, responses, notifications, and transient state are unversioned because they are not persisted or independently exchanged release formats.

## 7.1 State

Add these logical types; exact TypeScript module placement may follow the existing protocol/domain split:

```ts
interface VaultSummary {
  readonly vaultId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly active: boolean;
  readonly unlocked: boolean;
  readonly manuallyLocked: boolean;
}

interface VaultBusyState {
  readonly vaultId: string;
  readonly operation: "Capture" | "Vacuum" | "Export";
}

interface WorkspaceState {
  readonly workspaceId: string;
  readonly activeVaultId?: string;
  readonly vaults: readonly VaultSummary[];
  readonly busy?: VaultBusyState;
}

interface AppState {
  readonly workspace: WorkspaceState;
  readonly latestJob?: CaptureJob;
  readonly latestWarnings?: readonly CaptureWarningId[];
  readonly recentCapture?: RecentCapture;
}
```

Sort Vault summaries by normalized name, then creation timestamp, then Vault ID. The sort must be deterministic and must not depend on browser locale.

`RecentCapture` includes `vaultId`. Any Library URL constructed for a Capture includes both `vaultId` and `bundleId`.

## 7.2 Requests

Add these application requests:

```ts
{ type: "GetState" }

{ type: "SuggestVaultName" }

{
  type: "CreateVault";
  expectedActiveVaultId?: string;
  name: string;
  passphrase?: string;
}

{
  type: "SelectActiveVault";
  expectedActiveVaultId: string;
  vaultId: string;
}

{
  type: "RenameVault";
  expectedActiveVaultId: string;
  vaultId: string;
  name: string;
}
```

Every existing Vault-scoped application request includes `expectedVaultId`. This includes unlock, lock, dismiss Capture notice, Capture, Library reads, Library mutations, Collection operations, detail reads, Vacuum, and Vacuum estimate.

Before any plaintext access or persistent write, the Runtime verifies that `expectedVaultId` equals the current active Vault. Verify it again inside every authoritative commit transaction.

## 7.3 Runtime notifications

Use one payload-free UI invalidation notification:

```ts
interface AppStateChanged {
  readonly type: "AppStateChanged";
}
```

Every successful mutation that can affect an open surface publishes this notification after its
authoritative state transition. Long-running Capture and Vacuum operations publish it as visible
busy and completion state changes. Background request handling distinguishes notifications from
requests. Popup and Library subscribe before their initial fetch, serialize reconciliation, discard
context-bound decrypted/detail state and Blob URLs, fetch canonical state, and render only the
newest reconciliation. They also reconcile on visibility and focus.

## 7.4 Errors

Add stable Runtime error IDs:

- `INVALID_VAULT_NAME`: normalized input violates the name contract.
- `VAULT_NOT_FOUND`: a requested Vault is not registered in the Workspace.
- `VAULT_CONTEXT_CHANGED`: expected and active Vault IDs differ.
- `VAULT_BUSY`: Create, Select, or Rename raced with Capture or Vacuum.

Error messages may be user-friendly, but callers must branch only on IDs.

---

# 8. Commands, Events, and Projections

## 8.1 Commands

Define Runtime Commands:

- `CreateVault`
- `SelectActiveVault`
- `RenameVault`

`CreateVault` and `RenameVault` validate and produce Events. `SelectActiveVault` changes only device-local operational state and produces no Event.

Commands are never synchronized.

## 8.2 VaultCreated v1

Persist the encrypted canonical CBOR payload:

```text
version: 1
eventType: VaultCreated
eventVersion: 1
payloadVersion: 1
vaultId: UUID
deviceId: UUID
timestamp: canonical UTC timestamp
protocolVersion: 1
name: normalized Vault name
```

Creation timestamp in `VaultCreated`, Vault metadata, and Workspace directory must be the same value.

## 8.3 VaultRenamed v1

Persist the encrypted canonical CBOR payload:

```text
version: 1
eventType: VaultRenamed
eventVersion: 1
payloadVersion: 1
vaultId: UUID
deviceId: UUID
timestamp: canonical UTC timestamp
protocolVersion: 1
name: normalized Vault name
```

Do not include a mutable previous-name field. Current name is obtained by deterministic replay.

## 8.4 Vault Name Projection

Add an encrypted `VaultNameProjectionV1`:

```ts
interface VaultNameProjectionV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly name: string;
  readonly sourceEventId: string;
  readonly updatedAt: string;
}
```

Replay rules:

1. `VaultCreated` initializes the Projection and must be the first name Event.
2. `VaultRenamed` replaces name, source Event ID, and updated timestamp.
3. Order Events by `orderingTimestamp`, then Event ID, matching existing deterministic replay.
4. A duplicate Event ID is idempotent.
5. A Rename before Create, a second Create, a mismatched Vault ID, or an invalid name fails rebuild.
6. Concurrent future Renames converge by the same total order; the last ordered valid Rename wins.

The encrypted Projection uses the existing `vault:projection:v1` derivation domain with context ID `VaultName-v1:<vaultId>`.

---

# 9. Persisted Storage Contract

## 9.1 Canonical pre-release schema

- The sole canonical IndexedDB schema is initial schema version 1.
- Existing development databases from discarded drafts are deleted and recreated outside product Runtime behavior.
- The product contains no schema upgrade, alternate reader, preservation branch, or description of a superseded schema.

## 9.2 Workspace stores

Add:

```text
workspace_metadata
workspace_keys
vault_directory
vault_name_cache
vault_name_projection
```

Persist:

```ts
interface WorkspaceMetadataV1 {
  readonly version: 1;
  readonly workspaceId: string;
  readonly activeVaultId?: string;
  readonly createdAt: string;
}

interface VaultDirectoryEntryV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly createdAt: string;
}

interface WorkspaceVaultNameCacheV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceEventId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}
```

The directory contains no plaintext Vault name.

Generate one non-exportable 256-bit AES-GCM Workspace name-cache key and persist it as a structured-cloned `CryptoKey` under `workspace_keys`. Encrypt each cache entry with a fresh 96-bit nonce. Authenticate canonical CBOR AAD containing:

```text
awsm:workspace-vault-name-cache:v1
workspaceId
vaultId
cache version
```

The cache is local, rebuildable, excluded from synchronization and Backup, and not authoritative. Cache corruption must not make Vault contents inaccessible: display the neutral placeholder `Vault <last-six-id>` until the Vault is unlocked and the cache is rebuilt.

## 9.3 Vault-scoped keys

Use one IndexedDB database. Prefix every Vault-owned record key with Vault ID.

Canonical out-of-line keys:

| Store                   | Key                       |
| ----------------------- | ------------------------- |
| `vault_metadata`        | `[vaultId, "metadata"]`   |
| `key_slots`             | `[vaultId, slotKind]`     |
| `device_keys`           | `[vaultId, "device"]`     |
| `objects`               | `[vaultId, objectId]`     |
| `events`                | `[vaultId, eventId]`      |
| `library_projection`    | `[vaultId, bundleId]`     |
| `collection_projection` | `[vaultId, projectionId]` |
| `vault_name_projection` | `[vaultId, "active"]`     |
| `capture_jobs`          | `[vaultId, jobId]`        |
| `command_outcomes`      | `[vaultId, commandId]`    |
| `vault_generations`     | `[vaultId, generationId]` |
| `vault_head`            | `[vaultId, "active"]`     |
| `vacuum_jobs`           | `[vaultId, jobId]`        |

Create one Driver helper for exact keys and one for Vault-prefix `IDBKeyRange`. All Driver enumeration, count, clear, rebuild, and recovery methods must use those helpers. Do not call `clear()` on a shared Vault-owned store.

Every decoded stored record also contains and validates its `vaultId`; the key prefix alone is not sufficient trust-boundary validation.

## 9.4 Stored Event

Replace the singular Bundle anchor with explicit dependencies:

```ts
interface StoredEvent {
  readonly version: 1;
  readonly vaultId: string;
  readonly eventId: string;
  readonly referencedObjectIds: readonly string[];
  readonly orderingTimestamp: string;
  readonly envelopeBytes: Uint8Array;
}
```

- `VaultCreated` and `VaultRenamed` use an empty dependency list.
- `BundleRegistered` references its Bundle Descriptor Object ID and exact Artifact Object closure.
- Capture lifecycle and Collection Events retain their current applicable Bundle dependencies as canonical sorted unique lists.
- Update Vacuum and decoders to consume the list; do not invent a placeholder Object for Vault Events.

## 9.5 Capture Job

Add `vaultId` to every Capture Job and validate it at decode time. All job reads, writes, latest-job selection, interruption recovery, notice dismissal, and outcomes are scoped to that Vault.

`latestCaptureJob(vaultId)` means latest for the named Vault, not latest across the Workspace.

---

# 10. Runtime Structure and Transaction Boundaries

## 10.1 Workspace Service

Add a Host-independent Workspace Service responsible for:

- Workspace bootstrap;
- Vault directory listing;
- active selection;
- generated-name suggestions;
- encrypted name-cache reads and writes;
- duplicate display disambiguation; and
- constructing a Vault-scoped Runtime context.

The browser Host renders returned state. It must not generate names, choose active Vaults, manage Root Keys, or address IndexedDB directly.

## 10.2 Vault context

Replace background module globals with a context manager holding at most one active `VaultService`, scoped `IndexedDbDriver`, and Root Key.

Every operation obtains an immutable context snapshot containing:

```text
workspaceId
vaultId
VaultService
Vault-scoped Driver
context generation/token
```

The context token changes after Create or Select. Validate it before commit in addition to the persisted expected Vault check.

Never retain Root Keys for inactive Vaults.

## 10.3 Workspace bootstrap

On first startup, atomically create Workspace metadata and the non-exportable name-cache key. This is harmless operational state and does not create a Vault.

With no Vaults, `activeVaultId` is absent and popup state is onboarding.

With existing Vaults, `activeVaultId` must name exactly one directory entry. Missing or dangling active selection is storage corruption and must fail safely rather than select an arbitrary Vault.

## 10.4 Atomic Create

One IndexedDB read-write transaction must:

1. verify `expectedActiveVaultId` still matches Workspace metadata;
2. verify no active Capture or Vacuum blocks management;
3. normalize and validate the submitted name;
4. generate a new Vault ID, Device ID, Root Key, slots, verifier, and generation zero;
5. encrypt `VaultCreated` and the initial Vault Name Projection;
6. encrypt the local Workspace name-cache value;
7. mark the previous active Vault metadata `manuallyLocked: true`, if one exists;
8. insert new Vault metadata, slots, device key, generation, head, Event, Projection, directory entry, and cache;
9. set Workspace `activeVaultId` to the new Vault; and
10. commit all records together.

Generation zero remains an immutable `Initial` manifest with empty reachability sets. Its operational head tail contains the `VaultCreated` Event ID.

Only after transaction commit may Runtime discard the previous Root Key and retain the new Root Key. On abort, wipe the new raw Root Key, leave the old context unchanged, and expose no directory entry for the failed Vault.

## 10.5 Atomic Select

One transaction must:

1. require `expectedActiveVaultId` to match current Workspace metadata;
2. require the target directory and Vault metadata to exist;
3. reject selection of the already active Vault as a no-op success;
4. reject while Capture or Vacuum is active;
5. set both previous and target Vault metadata to `manuallyLocked: true`; and
6. set Workspace `activeVaultId` to the target.

After commit, discard the previous Root Key, install a locked target context, broadcast
`AppStateChanged`, and return fresh state. If any step fails, retain the previous context and do not
broadcast.

## 10.6 Atomic Rename

Rename requires `vaultId === expectedActiveVaultId === activeVaultId`, an unlocked Vault, and no Capture or Vacuum.

One transaction must:

1. validate the active Vault and generation head;
2. normalize the new name;
3. treat an exact canonical match as a no-op success without an Event;
4. append encrypted `VaultRenamed`;
5. replace the encrypted Vault Name Projection;
6. update the encrypted Workspace name cache;
7. append the Event ID to the generation head tail; and
8. commit atomically.

After commit, broadcast an active-state invalidation so every surface renders the new name.

## 10.7 Deep links and stale surfaces

Library links use:

```text
library.html?vaultId=<uuid>&bundleId=<uuid>
```

If the URL Vault differs from the active Vault, do not query by Bundle ID and do not switch silently. Render the cached target name and an explicit `Switch to this Vault` action. That action follows the normal Select flow and then requires unlock.

On `VAULT_CONTEXT_CHANGED`, discard stale UI data, revoke screenshot/MHTML Blob URLs, announce that the active Vault changed, and reload state.

---

# 11. Vault Vacuum and Replay Integration

Vault Vacuum must understand the new authoritative Events.

- Authenticate and decode `VaultCreated` and `VaultRenamed` during analysis.
- Retain those Events byte-for-byte because they do not depend on Deleted Captures.
- Include them in successor generation reachability.
- Rebuild and compare the Vault Name Projection before activation.
- Preserve the same final Vault name and source Event ID after Vacuum.
- Continue failing closed on unsupported authoritative Event or Object dependencies.
- Scope the Vacuum lease, estimates, reads, activation, deletion, and cleanup to one Vault ID.

Projection rebuild must rebuild both Library/Collection Projections and the Vault Name Projection without allowing one Projection family to make the other authoritative.

---

# 12. UI Implementation Detail

## 12.1 Shared state behavior

Keep UI rendering functions pure where practical and unit-test their state selection separately from DOM wiring.

Both popup and Library must show:

- label `Vault`;
- active name;
- `Locked` or `Unlocked` text;
- secondary Vault management inside the Library Settings dialog;
- busy text when management actions are unavailable.

Only the Library exposes Rename. The popup remains focused on Capture.

Color must not be the only state signal.

## 12.2 Picker

Use native accessible controls inside a modal dialog or equivalent focus-managed popup panel.

Each Vault option shows:

- name or corruption placeholder;
- `Current` for the active Vault;
- creation date; and
- short ID only when needed to disambiguate a duplicate or placeholder name.

The picker explains: `Switching locks the current Vault.`

On open, the active Vault is identified in the Vault Settings tab. Escape closes without changes. After close, restore focus to `Settings`.

## 12.3 Inline rename

The approved `04-library-centered-vault-rename.md` plan owns the interaction. The Library heading is
the active Vault name and its accessible title control enters a single inline editor. Enter or
`Rename` submits. Escape or focus leaving the form discards the draft. There is no rename dialog,
popup Rename action, or Cancel button.

## 12.4 Creation

The create form contains:

- generated editable `Vault name` input;
- `Generate another name` button;
- no local passphrase or recovery-credential control;
- passphrase input enabled only when selected;
- `Create Vault` primary action; and
- `Cancel` for secondary creation, but not first-run onboarding.

Creating another Vault explains that the current Vault will be locked. Do not expose another Vault's name or passphrase in form values.

## 12.5 Locked target

After Select, render the existing unlock choices for the new active Vault. Keep the switcher available so the user can choose a different Vault without unlocking the current target.

Rename, Capture, Library content, and Vault Vacuum remain unavailable until unlock.

---

# 13. Documentation Reconciliation

Update all affected documents in the same implementation change.

At minimum:

1. define Workspace and Active Vault in the normative glossary;
2. update the Vault specification with Workspace membership, encrypted Vault names, and local active selection;
3. define `CreateVault`, `SelectActiveVault`, `RenameVault`, `VaultCreated`, and `VaultRenamed` in the owning Command/Event specifications;
4. update Event serialization examples and dependency semantics for `referencedObjectIds`;
5. update Runtime and client architecture responsibilities for the active context manager;
6. update Capture Jobs to name their Vault;
7. update Vault Vacuum requirements to retain Vault name history;
8. update testing strategy with cross-Vault isolation and stale-context invariants; and
9. replace the PRD open question about exposing multiple Vaults with the decisions in this plan.

Describe only the canonical current design. Do not mention discarded pre-release representations.

---

# 14. Cold-Start Implementation Order

Follow this order. Do not begin with UI.

## Task 1: Documentation contracts

**RED/inspection gate:** search every owning document for statements that conflict with the
Workspace, Active Vault, encrypted naming, or explicit Vault-context contracts in this plan.

**GREEN:** reconcile terminology, Commands, Events, persisted formats, Capture Job context, Vacuum, testing, and PRD scope according to section 13.

**Verification:** run Markdown metadata and normative-term searches from `AGENTS.md`; manually verify all affected dependencies.

## Task 2: Name domain and generator

**RED:** add unit tests for NFC, whitespace handling, length, forbidden controls, duplicate display detection, CSPRNG injection, collision retry, and suffix exhaustion behavior.

**GREEN:** implement the Runtime-owned validation and versioned preservation-themed generator.

**Verification:** focused name tests, full unit suite, typecheck.

## Task 3: Canonical decoders and types

**RED:** add decoder tests rejecting missing/malformed Vault IDs, invalid Workspace records, extractable cache keys, malformed cache envelopes, invalid names, unsorted dependencies, and version 1 persisted records.

**GREEN:** introduce Workspace, Vault summary, Capture Job, Stored Event, scoped record, and unversioned application protocol/state types and decoders.

**Verification:** decoder tests, crypto tests, typecheck.

## Task 4: Canonical IndexedDB schema and strict Vault scoping

**RED:** browser integration tests create two Vault prefixes with colliding local entity IDs and prove exact isolation for get/list/count/clear/rebuild/job/outcome/head/Vacuum operations.

**GREEN:** replace stores, add key/range helpers, add Workspace stores, and refactor every Driver method to require Vault ID.

**Verification:** IndexedDB integration suite; search for unscoped `getAll`, `count`, `clear`, singleton `active` keys, and parameterless Vault reads.

## Task 5: Workspace cache encryption

**RED:** tests prove names are absent as plaintext from directory records, cache decrypts while Vault is locked, nonce/AAD tampering fails, corruption yields the neutral placeholder, and unlock can rebuild cache.

**GREEN:** implement Workspace bootstrap, non-exportable AES-GCM key persistence, encrypted cache, and corruption placeholder behavior.

**Verification:** focused crypto/storage tests and real-browser structured-clone test for the non-exportable key.

## Task 6: Vault name Events and Projection

**RED:** tests cover Create, Rename, no-op Rename, invalid history, deterministic concurrent order, replay idempotency, encrypted Projection round-trip, and rebuild.

**GREEN:** implement Event preparation/decoding, reducer, Projection encryption, and cache refresh integration.

**Verification:** Event, Projection, replay, and cryptographic suites.

## Task 7: Atomic Create

**RED:** failure-injection tests abort at each store write and prove no partial Vault, Event, directory, cache, active selection, or previous lock change is visible.

**GREEN:** implement the single-transaction Create boundary and post-commit Root Key/context transition.

**Verification:** Vault unit tests, IndexedDB integration tests, raw-key wipe assertions, restart test.

## Task 8: Atomic Select and Runtime context manager

**RED:** tests cover successful selection, same-target no-op, missing target, stale expected Vault, busy rejection, automatic previous/target locking, Root Key release, transaction failure, restart, and notification behavior.

**GREEN:** replace background globals with the active context manager and implement Select.

**Verification:** Runtime unit/integration tests and a static search proving no global unscoped Driver/VaultService remains.

## Task 9: Vault-scoped Capture and Library protocol

**RED:** tests prove a Capture Job records its Vault, stale requests return `VAULT_CONTEXT_CHANGED`, latest jobs are per Vault, Bundle IDs cannot be opened through another Vault, and deep links never switch silently.

**GREEN:** update all protocol requests, background handlers, Capture runtime, Library operations, recent-Capture links, and notifications.

**Verification:** existing Capture/Library/Collection/Vacuum suites plus new cross-Vault tests.

## Task 10: Atomic Rename and Vacuum

**RED:** tests cover rename atomicity, locked/busy rejection, cache/Event/Projection/head consistency, Vacuum retention, and name equality before and after Vacuum.

**GREEN:** implement Rename commit and update Vacuum/rebuild logic for Vault lifecycle Events.

**Verification:** management, replay, Vacuum, and browser integration suites.

## Task 11: Popup and Library UX

**RED:** UI tests cover onboarding suggestion, regenerate, create, picker semantics, Library-title
inline Rename, duplicate disambiguation, busy state, switch explanation, focus restoration, live
announcements, locked target, context-change refresh, and the absence of Rename in the popup.

**GREEN:** implement shared selection state on both surfaces while keeping Rename contextual to the
Library title and retaining the established visual design system.

**Verification:** unit DOM helpers where applicable, packaged Playwright accessibility and keyboard workflows.

## Task 12: End-to-end completion gate

Run the packaged extension through this exact workflow:

1. first-run onboarding shows an editable generated name;
2. create Vault A without a passphrase;
3. Capture page A and verify it in Vault A's Library;
4. create Vault B with a passphrase and verify Vault A becomes locked;
5. Capture page B and verify Vault A's content is absent;
6. switch to Vault A and verify Vault B locks and Vault A requires explicit unlock;
7. unlock Vault A and verify only page A is present;
8. rename Vault A and verify popup and open Library update;
9. give Vault B the same name and verify both picker entries are disambiguated;
10. attempt a switch during Capture and verify UI disablement plus Runtime `VAULT_BUSY` enforcement;
11. restart the extension and verify active selection, automatic locked state, and visible cached names;
12. Vacuum one Vault and verify the other Vault and both names remain unchanged; and
13. use a mismatched deep link and verify an explicit switch prompt rather than cross-Vault lookup.

---

# 15. Required Verification Commands

Discover commands from manifests if they change. With the current repository, completion requires:

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:e2e:chrome
```

Also run:

```bash
rg -n 'new IndexedDbDriver\(\)|new IndexedDbVaultRepository\(\)|\.clear\(\)|getAll\(\)|get\("active"\)' apps/browser-extension/src
rg -n 'App(State|Request|Response)V[0-9]|CaptureJobV[0-9]|StoredEventV[0-9]|version: [0-9].*type:' apps/browser-extension
rg -n 'active Vault|multiple Vault|VaultCreated|VaultRenamed|Workspace' docs README.md VISION.md
```

Every match must be either removed, explicitly Vault-scoped, or intentionally documented. Generated build output is not evidence of source correctness.

---

# 16. Acceptance Criteria

The feature is complete only when all statements are true:

1. A fresh user can accept or edit a generated preservation-themed Vault name.
2. A user can create multiple Vaults with independent Root Keys and local device slots.
3. Popup and Library show and switch the same global active Vault.
4. Switching manually locks the previous Vault and requires explicit unlock of the target.
5. Only the active unlocked Vault can receive Captures or expose Library plaintext.
6. Capture Jobs and every stored record are explicitly scoped by Vault ID.
7. Stale requests cannot execute against a different active Vault.
8. Vault names are encrypted authoritative Event-derived state.
9. Locked pickers obtain names only from a device-local encrypted rebuildable cache.
10. Rename updates Event history, Projection, cache, generation head, popup, and Library atomically.
11. Duplicate names remain valid and are visibly disambiguated without changing identity.
12. Vault Vacuum preserves Vault naming history and never touches another Vault.
13. Create, Select, Rename, Capture, Projection rebuild, and Vacuum failure tests prove atomicity and isolation.
14. No plaintext Vault name appears in the Workspace directory, diagnostics, logs, protocol errors, or unencrypted server-bound state.
15. There is one canonical initial IndexedDB format and no alternate or upgrade branch.
16. Unit, integration, typecheck, lint, build, and packaged Chrome E2E gates pass.

---

# 17. Explicitly Deferred

Do not add any of the following while implementing this plan:

- Vault deletion or removal from the Workspace;
- moving, copying, or linking Captures across Vaults;
- automatic capture routing rules;
- per-window or per-tab active Vaults;
- keeping multiple Root Keys unlocked;
- synchronized active selection;
- synchronized Workspace name cache;
- plaintext Vault names at the coordination boundary;
- passphrase reuse, change, recovery, or inheritance;
- Vault Import, Export, Backup, Restore, sharing, or enrollment;
- alternate readers or multiple persisted representations.
