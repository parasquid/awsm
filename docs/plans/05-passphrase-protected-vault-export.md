# Passphrase-Protected Vault Export

**Document:** `docs/plans/05-passphrase-protected-vault-export.md`
**Status:** Approved implementation plan
**Owner:** Engineering
**Last Updated:** 2026-07-18
**Depends On:** `docs/plans/03-multiple-vault-management.md`,
`docs/plans/04-library-centered-vault-rename.md`, and the architecture and specifications reconciled
by this plan

**Current package authority:**
`docs/plans/06-independent-artifact-vault-graph-and-selective-export.md`. Plan 06 retains the
passphrase and ZIP64 decisions while replacing package inventory, coverage, Artifact payload, and
validation contracts. Use the current Import and Export Specification for implementation.

**Current Import authority:** `docs/plans/07-complete-vault-package-import.md`. Plan 07 implements
Complete package ingestion while Selective Import, merging, replacement, and remote availability
remain deferred.

---

# 1. Purpose and Roadmap Context

This is the decision-complete implementation plan for exporting one complete local Vault from the
AWSM browser extension. The implementer is expected to begin from a cold checkout with no prior
conversation context. Do not reopen decisions recorded here.

The Roadmap distinguishes three different capabilities:

1. **Export/Import** is portable manual transfer of one Vault.
2. **Backup/Restore** creates and applies recovery points.
3. **Synchronization** maintains converging replicas through an untrusted Coordination Server.

This plan implements only the Export half of the first capability. It creates a self-contained,
passphrase-protected package that Complete Import validates and uses to create the
contained Vault locally. It does not provide continuous synchronization, automated recovery,
retention, or a second authoritative replica.

The Roadmap also states that local-only use requires no Account and no persistent Vault passphrase.
This plan makes that current local model canonical:

- a local Vault has exactly one device slot backed by a non-exportable local device key;
- a fresh export passphrase protects each exported package; and
- the export passphrase does not become a Vault unlock method or modify local Vault state.

This plan supersedes every optional local passphrase-slot requirement in the earlier multiple-Vault
and capture plans. Account passwords, Account Recovery Keys, synchronized Vault wrappers,
and trusted-Device enrollment remain Roadmap discovery work and are not changed or implemented here.

The completed feature lets a user:

1. open an unlocked Vault in the Library;
2. choose `Export Vault` from the Vault-management bar;
3. create and confirm a fresh export passphrase;
4. watch a cancellable, live Export Job verify and package the Vault;
5. choose a destination through Chrome's Save As dialog; and
6. receive one neutral, dated `.awsm` file containing the complete active Vault Generation.

The implementation also adds a strict, read-only package validator. The validator proves that the
writer produces a package the Complete Import implementation consumes, but this Export plan does not create,
replace, merge, or mutate any Vault.

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
- Use real IndexedDB browser integration tests for leases, snapshots, and interruption recovery.
- Use the packaged Chrome extension for Save As, cancellation, download, and live-surface evidence.
- Every user-visible state requires rendered screenshot inspection at primary and narrow widths.
- Record RED and GREEN commands and results in
  `docs/plans/05-passphrase-protected-vault-export-tdd-evidence.md` as implementation proceeds.

---

# 3. Fixed Product Decisions

## 3.1 Export purpose

- Export produces a portable AWSM Vault Package for later AWSM Import.
- Export is not Backup and must never be labeled or described as Backup.
- A package contains one complete active Vault Generation, not an independently mutating replica.
- Importing the same package onto two disconnected devices creates divergent
  local replicas if both later accepted mutations; Export does not solve convergence.
- The first implementation is full-Vault only. Partial Export is not supported.
- Plaintext Export is not supported.
- Export requires no network, Account, Coordination Server, or synchronization state.

## 3.2 Local unlock model

- A local Vault has one mandatory device slot using its non-exportable AES-KW device key.
- Remove local passphrase slots completely from creation, storage, Runtime state, unlock, and UI.
- Manual lock remains. Unlocking a manually locked Vault uses `Unlock on this device` only.
- The generic Argon2id implementation remains solely because Export uses it.
- Losing the device key makes the local Vault unavailable unless the user has a valid Export or a
  future separately implemented recovery mechanism.
- Do not add a recovery promise to local onboarding. Export is user-initiated portability, not an
  automatic recovery guarantee.

## 3.3 Export passphrase

- Every Export requires a new passphrase and confirmation.
- The passphrase is exact input. Do not trim, normalize, case-fold, or otherwise transform it.
- Require at least 12 Unicode code points and at most 1,024 UTF-8 bytes.
- Confirmation must match the original string exactly before the Command is accepted.
- The passphrase, confirmation, and derived key exist only in trusted Runtime memory for the active
  operation.
- Never persist them in a Job, temporary file, Runtime Event, diagnostic, error detail, test
  artifact, screenshot, or log.
- JavaScript strings cannot be reliably wiped; clear DOM values promptly, release references in
  `finally`, and wipe every derived or raw byte array with the existing sodium-backed wipe helper.

## 3.4 Exported history

- Export complete active reachability: the union of the active encrypted Vault Generation
  Manifest's retained Object/Event IDs and the active head's appended Object/Event IDs.
- Include Captures in both Active and Deleted logical states.
- A user who wants Deleted history omitted must run Vault Vacuum successfully before Export.
- Export must not invoke Vault Vacuum, silently rewrite history, or create a successor Generation.
- Existing immutable Bundle and Event bytes remain byte-for-byte unchanged in the package.
- The active encrypted Generation and the operational head required to reconstruct its append tail
  are included.

## 3.5 Visible metadata and filename

- The package Manifest is readable without the passphrase.
- It may expose only operational interchange metadata: package ID, originating Vault ID, export
  timestamp, active Generation ID/number, canonical format versions, supported features, entry
  paths, record identifiers, counts, byte lengths, and checksums.
- It must not expose the Vault name, Capture titles, URLs, Collection names, timestamps derived from
  content, decrypted Event fields, or any other user content.
- Use MIME type `application/vnd.awsm.vault+zip`.
- Use the neutral UTC filename `awsm-vault-YYYY-MM-DD.awsm`. Do not include the Vault name.
- Set Chrome download `saveAs: true` for every Export.

## 3.6 Busy, cancellation, and completion behavior

- Export is an exclusive Vault operation from lease acquisition through terminal download state.
- Read-only Library browsing may continue, but the only permitted active-Vault action is
  `Cancel Export`.
- Block Capture, Delete, Restore, Merge, Move, Extract, Undo, Rename, Create, Select, Lock, and Vault
  Vacuum while the Export lease is active.
- Disabled controls are not the correctness boundary; every raced Runtime or storage request must
  return `VAULT_BUSY` without mutation.
- Cancellation is supported during Verify, Package, and Download.
- Cancellation deletes temporary output, releases the lease, and records a terminal Cancelled Job.
- Closing the Library tab does not itself cancel an accepted Export.
- Export succeeds only after Chrome reports the download complete. Starting a download is not
  success.
- Cancelling the Save As prompt or an active Chrome download produces Cancelled, not Failed.
- Browser shutdown or Runtime interruption produces Failed with `EXPORT_INTERRUPTED`; the Job is
  not resumable because its passphrase was intentionally never persisted.

---

# 4. Canonical Terminology and Invariants

Use the glossary's canonical capitalization: Vault, Object, Event, Bundle, Projection,
Materialization, Runtime, Host, Driver, Export, and Vault Generation.

Use these feature-specific terms consistently:

- **Vault Package:** the externally exchanged `.awsm` file produced by Export.
- **Export Manifest:** readable operational metadata and the authenticated inventory of the Vault
  Package.
- **Export Key Envelope:** the passphrase-derived authenticated wrapper for the Vault Root Key.
- **Export passphrase:** the transient secret protecting exactly one Vault Package.

Never call the export passphrase a Vault passphrase, recovery password, Account password, Account
Master Password, or device password.

Preserve these invariants:

1. Export never changes authoritative Vault state.
2. Export never creates an Event or a new Vault Generation.
3. Export never changes Object, Event, Bundle, Vault, or Generation identifiers.
4. Export never decrypts authoritative content into the package.
5. The package contains exactly the active Generation's complete reachability and no unrelated
   Vault record.
6. Projections, Materializations, caches, Jobs, outcomes, local slots, and diagnostics are absent.
7. A valid package plus its passphrase is sufficient to recover the contained Vault Root Key and
   authenticate every authoritative entry without the originating device.
8. The device key and device slot never leave local storage.
9. The Export Manifest and Export Key Envelope authenticate one another and cannot be substituted
   across packages or Vaults.
10. Wrong passphrase and tampered key-envelope failures expose one indistinguishable public
    authentication error.
11. Failure or cancellation leaves the source Vault byte-for-byte unchanged.
12. No Export operation crosses a Vault-prefixed storage range.

---

# 5. Canonical Vault Package Format

## 5.1 Format ownership and initial version

`docs/specifications/portability/import-export.md` owns the external format. Replace its current
implementation-defined and optional-encryption language with the one canonical format below.

This is the first canonical pre-release Vault Package format:

```text
export format version: 1
container: ZIP64
record serialization: canonical CBOR
entry compression: STORE (method 0)
```

Do not introduce another reader, format negotiation, a `V2` name, migration, or compatibility
branch. Future changes before first release replace this format in place and retain initial
numbering according to the repository policy.

## 5.2 Archive implementation

Add exact dependency `@zip.js/zip.js@2.8.31` for Vault Package ZIP64 streaming. Its documented
ZIP64 and Web Streams support is required because a Vault may exceed classic ZIP's 4 GiB archive
boundary. Artifact wrappers and Bundle Descriptors remain independent authoritative Objects; Vault
Package writing SHALL stream them without a nested Bundle container.

Configure the Vault Package writer and validator as follows:

- ZIP64 enabled for entries and central directory;
- compression method STORE for every entry because authoritative envelopes are already encrypted;
- forward-slash paths only;
- entries emitted in lexical path order;
- fixed DOS epoch modification time;
- no comments, platform permissions, extended timestamps, directory entries, or library-managed
  encryption;
- no duplicate paths;
- Web Streams connected to OPFS rather than an in-memory Blob; and
- cancellation propagated through one `AbortSignal`.

Given identical logical inputs, injected clock, package ID, salt, nonce, and ciphertext, the writer
must produce identical bytes.

## 5.3 Exact package layout

The only permitted entries are:

```text
key.cbor
manifest.cbor
generation.cbor
head.cbor
events/<event-id>.cbor
objects/<object-id>.cbor
```

Lexical ordering places fixed entries and UUID-addressed entries deterministically. The validator
must not depend on physical order, but it must require that the central-directory paths are already
in canonical lexical order.

Rules:

- `manifest.cbor` is one canonical `ExportManifestV1`.
- `key.cbor` is one canonical `ExportKeyEnvelopeV1`.
- `generation.cbor` is the canonical stored active Generation record, including its encrypted
  envelope bytes.
- `head.cbor` is the canonical active head captured under the Export lease.
- every `events/<id>.cbor` is the canonical stored Event wrapper whose `eventId` equals the path ID;
- every `objects/<id>.cbor` is the canonical stored Object wrapper whose `objectId` equals the path
  ID; and
- no empty directories, thumbnails, cover files, indexes, aliases, or optional sections exist.

## 5.4 Export Manifest

Define the external persisted type:

```ts
interface ExportManifestV1 {
  readonly exportFormatVersion: 1;
  readonly packageId: string;
  readonly createdAt: string;
  readonly originatingVaultId: string;
  readonly vaultFormatVersion: 1;
  readonly bundleFormatVersion: 1;
  readonly eventFormatVersion: 1;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly objectCount: number;
  readonly eventCount: number;
  readonly supportedFeatures: readonly ["full-vault", "vault-generation"];
  readonly entries: readonly ExportEntryDescriptorV1[];
  readonly contentIntegrity: {
    readonly algorithm: "hash:sha256:v1";
    readonly checksum: Uint8Array;
  };
}

interface ExportEntryDescriptorV1 {
  readonly path: string;
  readonly recordType: "VaultGeneration" | "VaultHead" | "Event" | "Object";
  readonly recordId: string;
  readonly byteLength: number;
  readonly checksumAlgorithm: "hash:sha256:v1";
  readonly checksum: Uint8Array;
}
```

Manifest rules:

- `packageId`, Vault ID, Generation ID, Event IDs, and Object IDs are canonical UUIDs.
- `createdAt` is the Export Job acceptance time in canonical UTC form.
- `entries` excludes `manifest.cbor` and `key.cbor` to avoid circular hashing.
- `entries` contains `generation.cbor`, `head.cbor`, every Event entry, and every Object entry.
- `entries` is sorted by `path` and has unique paths and record IDs within each record type.
- `objectCount` and `eventCount` exactly equal their descriptor counts.
- `contentIntegrity.checksum` is SHA-256 over canonical CBOR of the ordered `entries` array.
- `supportedFeatures` has exactly the two values and order shown above.
- Unknown, missing, duplicate, or out-of-order fields invalidate the Manifest.

## 5.5 Export Key Envelope

Define the external persisted type:

```ts
interface ExportKeyEnvelopeV1 {
  readonly exportKeyEnvelopeVersion: 1;
  readonly purpose: "VaultExport";
  readonly packageId: string;
  readonly originatingVaultId: string;
  readonly algorithm: "wrap:xchacha20poly1305:passphrase:v1";
  readonly kdf: "kdf:argon2id:v1";
  readonly operations: 3;
  readonly memoryBytes: 67108864;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly manifestChecksumAlgorithm: "hash:sha256:v1";
  readonly manifestChecksum: Uint8Array;
  readonly ciphertext: Uint8Array;
}
```

Cryptographic rules:

- Generate a fresh random 16-byte salt and 24-byte nonce for every Export.
- Derive a 32-byte key with Argon2id, three operations, and 64 MiB memory.
- `manifestChecksum` is SHA-256 of the exact canonical `manifest.cbor` bytes.
- Encode XChaCha20-Poly1305 associated data as canonical CBOR of:

```text
[
  exportKeyEnvelopeVersion,
  purpose,
  packageId,
  originatingVaultId,
  algorithm,
  kdf,
  operations,
  memoryBytes,
  salt,
  nonce,
  manifestChecksumAlgorithm,
  manifestChecksum
]
```

- Encrypt exactly the 32 raw Vault Root Key bytes.
- Require exactly 48 ciphertext bytes including the authentication tag.
- Wipe the raw Root Key and derived passphrase key in `finally` blocks.
- Validate all envelope fields before running Argon2id.
- Do not reuse the removed local passphrase-slot type, AAD, slot ID, or storage record.

## 5.6 Canonical stored-entry encoding

Encode the current stored records without reinterpretation:

```ts
interface ExportedStoredObjectV1 {
  readonly version: 1;
  readonly objectId: string;
  readonly objectType: "Bundle";
  readonly envelopeBytes: Uint8Array;
}

interface ExportedStoredEventV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly eventId: string;
  readonly referencedObjectIds: readonly string[];
  readonly orderingTimestamp: string;
  readonly envelopeBytes: Uint8Array;
}

interface ExportedVaultGenerationV1 {
  readonly version: 1;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly predecessorGenerationId?: string;
  readonly envelopeBytes: Uint8Array;
}

interface ExportedVaultHeadV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly generationId: string;
  readonly generationNumber: number;
  readonly appendedObjectIds: readonly string[];
  readonly appendedEventIds: readonly string[];
}
```

These are package-format representations of current canonical records, not compatibility DTOs.
Use shared strict decoders so storage, Export, and Import preflight cannot disagree.

Do not export local `VaultMetadataV1`: its Device ID, manual-lock flag, and verifier belong to the
originating device. Vault creation time and name remain recoverable from authenticated authoritative
Events. Complete Import creates new local device metadata, device key, device slot, and verifier.

## 5.7 Reachability and source verification

Before writing any package bytes, the Export Service must:

1. acquire the Vault-scoped Export lease and capture the active head;
2. load and authenticate the head's encrypted Vault Generation;
3. compute sorted unique Object and Event reachability as retained IDs union appended IDs;
4. prove the union exactly equals all authoritative Object and Event records stored for that Vault;
5. reject any missing, extra, duplicate, unsupported, or cross-Vault record;
6. authenticate and strictly decode every Event in canonical replay order;
7. verify each stored Event's Vault ID, Event ID, ordering timestamp, and dependency list against
   authenticated Event contents;
8. replay supported Vault, Library, lifecycle, and Collection Events successfully;
9. map every `BundleRegistered` fact to exactly one descriptor and its exact Artifact Object
   closure;
10. decrypt, decode, and verify every Bundle and Artifact checksum, including Deleted Captures; and
11. prove every referenced Object is reachable and every reachable Object is referenced by valid
    authoritative history.

Refactor duplicated Event authentication currently found in Projection rebuild and Vault Vacuum
into one Runtime-owned authoritative Event decoder. Export must not create a permissive parallel
decoder.

## 5.8 Completed-package validation

After streaming the package to temporary OPFS storage and before opening Save As, run the same
read-only validator shared with Import against the completed file and supplied passphrase.

The validator executes these phases:

1. stream and validate the ZIP64 central directory and canonical paths;
2. reject compression, encryption, directory entries, comments, duplicate paths, path traversal,
   unsupported fixed entries, and non-canonical ordering;
3. strictly decode `manifest.cbor` and `key.cbor`;
4. verify the Manifest checksum named by the key envelope;
5. derive the passphrase key and authenticate/unlock the Root Key;
6. verify package/Vault identity agreement across key envelope, Manifest, Generation, head, Events,
   and encrypted envelopes;
7. stream every inventoried entry, checking exact byte length and SHA-256;
8. reject any present entry absent from the authenticated inventory and any inventory entry absent
   from the archive;
9. authenticate the Generation, Events, and Bundles and prove exact reachability and replay; and
10. return an immutable `ValidatedVaultPackage` summary without persistent writes or plaintext
    content.

Use streaming readers and STORE-only entries so an unauthenticated package cannot force
decompression expansion. Apply explicit bounds to fixed records and existing canonical per-Bundle
limits before allocation. Total Vault size is not capped by a classic ZIP limit.

Public validator failures:

- wrong passphrase, substituted key envelope, or key-envelope authentication failure:
  `EXPORT_AUTHENTICATION_FAILED`;
- unsupported external format or algorithm version: `UNSUPPORTED_FORMAT_VERSION`;
- every other malformed, corrupt, incomplete, extra, cross-Vault, checksum, reachability, replay,
  or content-authentication failure: `EXPORT_PACKAGE_INVALID`.

Do not expose which key-envelope field differed when authentication fails.

---

# 6. Public Runtime and Application Contracts

Application requests, responses, notifications, and UI state remain unversioned because they are
local transient contracts. External Vault Package records and persisted Export Jobs carry versions.

## 6.1 Remove local passphrase contracts

Replace the pre-release contracts in place:

- remove `passphrase` from `CreateVault` requests and creation inputs;
- remove `UnlockPassphrase` requests and handlers;
- remove `PassphraseKeySlotV1` and `passphraseSlot` from `VaultRecordsV1`;
- remove `hasPassphraseSlot` from Vault summaries and Workspace state;
- remove `WRONG_PASSPHRASE` from local Vault unlock errors; and
- reject superseded request shapes rather than silently ignoring an old `passphrase` field.

`key_slots` remains the canonical store name because it stores the device slot. The only allowed
local slot key is `[vaultId, "device"]`.

## 6.2 Requests and results

Add:

```ts
{
  type: "ExportVault";
  expectedVaultId: string;
  passphrase: string;
}

{
  type: "CancelVaultExport";
  expectedVaultId: string;
  jobId: string;
}

interface ExportVaultResult {
  readonly jobId: string;
  readonly filename: string;
}
```

The Export request remains pending until Succeeded, Failed, or Cancelled so the initiating Library
can render the terminal result. The persisted Job and offscreen worker continue if the Library tab
closes after acceptance.

## 6.3 Export Job

Add the persisted operational record:

```ts
type ExportJobState =
  "Created" | "Running" | "Succeeded" | "Failed" | "Cancelled";

type ExportJobStage =
  "Preflight" | "Snapshot" | "Verify" | "Package" | "Download";

interface ExportJob {
  readonly version: 1;
  readonly vaultId: string;
  readonly jobId: string;
  readonly packageId: string;
  readonly state: ExportJobState;
  readonly stage: ExportJobStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedEntries: number;
  readonly totalEntries: number;
  readonly processedBytes: number;
  readonly totalBytes: number;
  readonly cancellationRequested: boolean;
  readonly errorId?: RuntimeErrorId;
}
```

Rules:

- Job progress is monotonic within one stage and never affects correctness.
- Counts and bytes are operational ciphertext/package measurements only.
- Persist `packageId`; never persist passphrase, derived key, raw Root Key, Vault name, or temporary
  absolute filesystem path.
- At most one non-terminal Export Job exists for one Vault.
- Terminal Jobs do not keep the Vault busy.
- Keep the latest terminal Job for visible completion/error state using the existing operational
  Job retention convention; it is excluded from Export, synchronization, and Backup.

## 6.4 State and busy model

Extend the current state types:

```ts
interface VaultBusyState {
  readonly vaultId: string;
  readonly operation: "Capture" | "Vacuum" | "Export";
}

interface AppState {
  readonly workspace: WorkspaceState;
  readonly latestJob?: CaptureJob;
  readonly latestExportJob?: ExportJob;
  // existing fields remain
}
```

Popup and Library derive busy presentation only from canonical refetched state. Do not send Job
state inside the invalidation notification.

## 6.5 Error identifiers

Add stable Runtime error IDs:

- `INVALID_EXPORT_PASSPHRASE`: passphrase length violates the canonical policy;
- `EXPORT_AUTHENTICATION_FAILED`: package passphrase/key authentication fails;
- `EXPORT_PACKAGE_INVALID`: source or completed package cannot be proven valid;
- `EXPORT_INTERRUPTED`: Runtime restarted or the offscreen worker disappeared before completion;
- `EXPORT_DOWNLOAD_FAILED`: Chrome or temporary-file output failed for a non-cancellation reason.

Cancelled is a terminal Job state, not an error ID. UI and callers branch on IDs and state, never on
diagnostic text.

---

# 7. Persisted Storage and Transaction Boundaries

## 7.1 Canonical store

Add the Vault-scoped store:

```text
export_jobs
```

Canonical key:

```text
[vaultId, jobId]
```

The sole pre-release IndexedDB schema remains initial version 1. Development databases are deleted
and recreated outside Runtime behavior. Do not add a schema migration, old-slot cleanup, alternate
reader, dual store, or database-version successor.

## 7.2 Lease acquisition

One IndexedDB transaction spanning `export_jobs`, `capture_jobs`, `vacuum_jobs`, `vault_head`, and
Workspace active selection must:

1. verify `expectedVaultId` equals the current active Vault;
2. verify the Vault is still unlocked in the active Runtime context;
3. reject any Created/Running Capture Job;
4. reject any Vacuum lease;
5. reject any non-terminal Export Job;
6. load the exact active Vault head;
7. insert the Created Export Job; and
8. commit before source enumeration begins.

After commit, transition to Running/Preflight and publish `AppStateChanged`.

## 7.3 Exclusive mutation checks

While a non-terminal Export Job exists, check the lease in the same transaction as every conflicting
state transition. Update at least:

- Capture Job creation and Bundle/Event registration;
- Delete/Restore and Collection mutation commits;
- Vault Rename and Create commits;
- active Vault Select;
- manual Lock;
- Vacuum acquisition and activation; and
- any future authoritative mutation encountered during implementation.

Checking only in the background handler or UI is insufficient. A raced transaction returns
`VAULT_BUSY` and writes nothing.

## 7.4 Snapshot stability

The lease freezes authoritative mutation and active context, so the captured head remains stable
through verification and package construction. Immutable Objects and Events may be read one at a
time by explicit reachable ID without buffering the Vault.

Before the Download stage, re-read the active head and prove it equals the captured head. Any
unexpected difference is `EXPORT_PACKAGE_INVALID`; never silently export a mixed snapshot.

## 7.5 Progress and cancellation transactions

- Persist stage/progress changes before broadcasting invalidation.
- A cancellation request sets `cancellationRequested: true` in a scoped transaction and signals the
  active worker through an `AbortController`.
- The worker checks persisted cancellation between records and responds promptly to the in-memory
  signal during hashing, ZIP writing, validation, and download.
- Terminal transition, lease release, and final progress update occur atomically in the Job record.
- Cleanup failure must not convert a valid source Vault into failure; retain a safe diagnostic and
  retry deletion at startup without exposing paths or content.

## 7.6 Restart reconciliation

At background startup, before reporting state:

1. find every Created/Running Export Job for the active Vault;
2. mark it Failed with `EXPORT_INTERRUPTED` and a fresh `updatedAt`;
3. release its busy effect through that terminal state;
4. ask the offscreen Export Host to remove OPFS temporary files named by known Job/package IDs; and
5. publish one invalidation if visible state changed.

Do not retry because the passphrase is gone. Do not persist a derived key to make retry possible.

---

# 8. Runtime, Driver, and Host Structure

## 8.1 Runtime Export Service

Add a Host-independent `VaultExportService` responsible for:

- validating export input;
- orchestrating source verification;
- building canonical entry records and checksums;
- creating the Export Manifest;
- asking the Vault key boundary for an Export Key Envelope;
- writing through an abstract package sink;
- invoking the read-only validator against completed output;
- reporting progress and cancellation; and
- producing only safe terminal outcomes.

Define narrow interfaces such as:

```ts
interface VaultExportRepository {
  acquireExport(...): Promise<ExportSnapshot>;
  getVaultGeneration(generationId: string): Promise<StoredVaultGenerationV1 | undefined>;
  getStoredObject(objectId: string): Promise<StoredObjectV1 | undefined>;
  getStoredEvent(eventId: string): Promise<StoredEvent | undefined>;
  updateExportJob(...): Promise<void>;
  finishExportJob(...): Promise<void>;
  cancellationRequested(jobId: string): Promise<boolean>;
}

interface ExportPackageSink {
  write(entries: AsyncIterable<ExportPackageEntry>, signal: AbortSignal): Promise<PackageHandle>;
  validate(handle: PackageHandle, passphrase: string, signal: AbortSignal): Promise<void>;
  download(handle: PackageHandle, filename: string, signal: AbortSignal): Promise<void>;
  cleanup(handle: PackageHandle): Promise<void>;
}
```

Exact module placement may follow existing Runtime/Driver conventions, but business rules must not
move into the Chrome Host or Library DOM code.

## 8.2 Vault key boundary

Do not expose raw Root Key bytes from `VaultService` as a general-purpose return value.

Add one narrow operation that:

1. reloads the canonical device slot and non-exportable device key;
2. unwraps the raw Root Key into a temporary byte array;
3. authenticates it with the existing Vault verifier and active Vault identity;
4. creates the Export Key Envelope for the supplied package/Manifest context; and
5. wipes the raw bytes before returning only the wrapped envelope.

The already-unlocked non-exportable HKDF Root Key remains available to the Export Service for
Generation/Event/Bundle authentication. No raw-key callback or extractable long-lived key may be
introduced.

## 8.3 IndexedDB Driver

Add explicit-ID reads and scoped iteration that load at most one authoritative record at a time.
Do not call `listStoredObjects()` or `listStoredEvents()` to materialize an arbitrarily large Vault
in memory during Export.

All decoded record IDs must equal their IndexedDB key components and the requested Vault context.

## 8.4 Chrome Export Host

Use the existing trusted offscreen extension document for streaming file and download work, with a
shared lifecycle manager rather than independent code that can close the document out from under
another operation.

The Host must:

- accept only a strict internal Export work message not claimed by the application request router;
- operate in the trusted extension origin;
- stream ZIP64 bytes to an OPFS temporary file keyed by Job/package ID;
- create a Blob/Object URL from the completed OPFS `File` without base64 conversion;
- call the Chrome downloads API with `saveAs: true` and the neutral filename;
- monitor the returned download ID until complete, interrupted, or cancelled;
- cancel the Chrome download when the Export AbortSignal fires;
- revoke the Object URL and delete the OPFS file in `finally`; and
- close the offscreen document only when no screenshot or Export user remains.

Add the `downloads` permission to the manifest and approved release-permission allowlist. Do not add
host permissions.

The passphrase may cross only the extension's own trusted message boundary and must be removed from
message objects/references after worker acceptance. Never encode package bytes or passphrases as
base64 application messages.

---

# 9. Library and Popup UX

## 9.1 Entry point

Add `Export Vault` to the Library Vault-management bar beside Switch/Create controls.

- The control is visible but disabled while the active Vault is locked or busy.
- Its accessible name is exactly `Export Vault`.
- The popup does not expose an Export entry point.
- Locked state continues to offer only device unlock and Vault switching.

## 9.2 Export dialog

Use the established focus-managed modal dialog composition.

Initial state contains:

- heading `Export Vault`;
- explanatory text: `Create a portable encrypted copy of this Vault. This is not a Backup.`;
- warning: `You will need this export passphrase to Import the Vault. AWSM cannot recover it.`;
- note: `Deleted captures remain included until you run Vault Vacuum.`;
- `Export passphrase` password input with `autocomplete="new-password"`;
- `Confirm export passphrase` password input;
- primary `Export Vault` button; and
- secondary `Cancel` button.

Validation behavior:

- show an adjacent error for fewer than 12 code points, more than 1,024 UTF-8 bytes, or mismatch;
- remain open and preserve both input values on validation error;
- never place password values in an announcement or error string;
- clear both inputs immediately after Runtime acceptance; and
- submit exactly once even if Enter and click race.

Before acceptance, Escape or Cancel closes and restores focus to the entry control.

## 9.3 Running state

After acceptance, keep the dialog in the same geometry and replace the form with:

- stage text such as `Verifying Vault`, `Creating encrypted package`, or `Saving export`;
- a visible progress element with an accessible label;
- ciphertext/package entry or byte progress without content names;
- `Cancel Export`; and
- no close-on-Escape behavior that could masquerade as cancellation.

When cancellation is requested, show `Cancelling export…`, disable repeated cancellation, and wait
for the terminal state.

If the initiating Library closes, another open Library or popup still observes Export busy state
through canonical App state.

## 9.4 Terminal states

- Succeeded: close the dialog, restore focus to `Export Vault`, and announce
  `Vault export saved as <filename>.`.
- Cancelled: close the dialog, restore focus, and announce `Vault export cancelled.`.
- Failed: keep the dialog open with a safe error and `Close`; do not offer automatic retry with the
  discarded passphrase.
- A context invalidation that could represent lock or active-Vault replacement clears dialog-bound
  plaintext immediately before reconciliation. The Export lease should make such a context change
  impossible through valid Runtime operations.

## 9.5 Live surfaces

Every persisted Job stage, cancellation, and terminal transition publishes the canonical
payload-free `AppStateChanged` invalidation.

Popup and Library must:

- subscribe before initial fetch;
- refetch canonical state;
- generation-guard or serialize reconciliations;
- coalesce bursts without losing the final transition;
- reconcile on focus/visibility; and
- show `Export in progress` while disabling Capture, lock, switch, create, rename, Library mutation,
  and Vacuum controls.

At least two surfaces must prove progress, cancellation, success, and failure without reload.

## 9.6 Visual contract

- The new management action follows the existing wrapping gap, button scale, and content grid.
- The dialog must fit within 390 px without horizontal overflow.
- Password controls have meaningful rendered width and height, visible labels, and visible focus.
- Error text remains adjacent without moving the surrounding Library header or management row.
- Running and cancellation states preserve dialog position and control prominence.
- The progress element has a readable label and is not conveyed by color alone.
- Disabled conflicting controls retain readable text and do not collapse.

---

# 10. Documentation Reconciliation

Reconcile all affected documents in the implementation change. This approved plan wins over stale
Draft documentation and earlier approved-plan details that conflict with it.

At minimum:

1. replace optional local passphrase slots with device-only local unlock in Vault and cryptography
   specifications;
2. scope Argon2id passphrase wrapping to the Export Key Envelope;
3. replace the Import/Export specification with the exact canonical package, encryption,
   integrity, validation, and full-Vault behavior in section 5;
4. define Export Job interruption, cancellation, progress, and persistence in Runtime Jobs;
5. update Runtime and Host architecture for the Export Service, sink, OPFS, and download boundary;
6. update security documentation to distinguish export passphrases from future Account Master
   Passwords and Recovery Keys;
7. update the testing strategy with package vectors, lease races, streaming, live surfaces, and
   rendered Export states;
8. revise the MVP PRD to state device-only local unlock and full encrypted Export behavior;
9. revise plans 02 and 03 plus their evidence claims so they describe the one canonical device-only
   local model rather than superseded passphrase slots;
10. keep the Roadmap's local-only manual-portability distinction and remove or clarify any wording
    that implies Export is synchronization, Backup, or an Account recovery mechanism; and
11. update dependency metadata and consistency-review claims wherever Export, key wrapping, or
    local recovery is described.

Do not edit the Roadmap's unresolved Account authentication, Account Encryption Key, Account Master
Password, Account Recovery Key, synchronization, Rails, or web-client choices except to prevent a
direct terminology conflict with the canonical local Export model.

Erase superseded pre-release history from product-facing documentation. Do not describe the current
device-only model as a migration or successor version.

---

# 11. Cold-Start Implementation Order

Follow this order. Do not begin with the UI.

## Task 1: Reconcile owning documentation

**RED/inspection gate:** search specifications, architecture, plans, PRD, Roadmap, and tests for
local passphrase slots, optional/plaintext Export, implementation-defined Export serialization,
partial Export, and Backup/Export conflation.

**GREEN:** update all owning documents according to section 10 and establish the exact package
contract before production types exist.

**Verification:** run the Markdown metadata and normative-term searches from `AGENTS.md`; manually
verify dependencies and canonical capitalization.

## Task 2: Remove local Vault passphrases

**RED:** update Vault, Workspace, protocol, UI-view, integration, and packaged-extension tests to
require device-only creation/unlock and rejection of superseded passphrase request/record shapes.

**GREEN:** remove passphrase slot types, decoders, persistence, creation, unlock, UI, state flags,
and local error IDs. Retain and rename/generalize only the Argon2id primitive needed by Export.

**Verification:** focused Vault/Workspace/protocol/UI tests, raw IndexedDB inspection, and searches
listed in section 12.

## Task 3: Package types, strict decoders, and vectors

**RED:** add fixtures and tests for every exact section 5 type, canonical CBOR byte stability,
unknown/missing fields, path/ID mismatches, sorting, counts, checksums, and fixed ZIP metadata.

**GREEN:** implement Manifest, key-envelope, entry-record, and path decoders plus injected clock,
UUID, salt, and nonce sources.

**Verification:** focused format tests, typecheck, and checked-in cryptographic/serialization vectors.

## Task 4: Export Key Envelope

**RED:** test correct unwrap, wrong passphrase, every authenticated-field mutation, Manifest
substitution, cross-package/Vault substitution, random salt/nonce, exact KDF parameters, raw-key
wipe, and absence of local-slot reuse.

**GREEN:** implement the narrow Vault key-boundary operation and validator-side unwrap/import.

**Verification:** crypto suite, vector equality, static search for raw-key escape, and memory-lifetime
review.

## Task 5: Export Job, lease, and source snapshot

**RED:** real IndexedDB tests cover acquisition, per-Vault isolation, every conflicting transaction,
read-only access, cancellation flag, head stability, terminal release, and interrupted restart.

**GREEN:** add the `export_jobs` store/repository, busy integration, explicit-ID source reads, and
startup reconciliation.

**Verification:** IndexedDB integration suite and a static audit of every authoritative mutation
transaction.

## Task 6: Authoritative source verification

**RED:** tests cover missing/extra Objects and Events, generation/head mismatch, corrupt envelopes,
stored-wrapper metadata mismatch, unsupported Event/Object type, broken dependency closure,
Deleted Bundle authentication, replay failure, and cross-Vault records.

**GREEN:** extract the shared authoritative Event decoder, authenticate exact reachability, replay
history, and authenticate every Bundle without relying on Projections.

**Verification:** Projection rebuild, Vault Vacuum, Library, and new Export verification suites all
use the shared decoder and remain green.

## Task 7: Streaming ZIP64 writer and validator

**RED:** tests prove canonical layout, deterministic bytes with injected randomness, ZIP64 output,
STORE-only entries, lexical paths, incremental reads, OPFS streaming, completed-package
self-validation, malformed archive rejection, and bounded memory behavior.

**GREEN:** add `@zip.js/zip.js@2.8.31`, implement the Runtime writer/validator and abstract sink,
and remove any whole-Vault list/buffer path.

**Verification:** force ZIP64 on a small deterministic fixture and assert the ZIP64 end-of-central-
directory structures and successful streaming validation. Separately use a generated incremental
source substantially larger than the test process's retained-memory allowance to prove OPFS output
and bounded heap growth. Do not write a multi-gigabyte test artifact merely to cross the boundary.

## Task 8: Chrome offscreen and download Host

**RED:** Host tests cover OPFS creation, no base64, Save As options, complete/interrupted/cancelled
download events, URL revocation, temp cleanup, shared offscreen lifetime, and missing permission.

**GREEN:** implement the offscreen Export worker, downloads integration, cleanup, and approved
permission allowlist update.

**Verification:** packaged Chrome download tests, build, and release-manifest verification.

## Task 9: Application protocol and live state

**RED:** tests cover Export/Cancel request decoding, stale Vault rejection, progress/terminal state,
payload-free invalidation, burst coalescing, focus reconciliation, and two open surfaces.

**GREEN:** wire background orchestration, App state, cancellation, and popup/Library busy behavior.

**Verification:** application protocol, Workspace, popup view, Library lifecycle, and live-surface
tests.

## Task 10: Library Export UX

**RED:** UI and packaged-browser tests cover locked/busy availability, focus, exact passphrase
validation, confirmation mismatch, submit deduplication, field clearing, progress, cancellation,
Save As, success, safe failure, restored focus, and no popup Export entry point.

**GREEN:** implement the Library bar action and complete dialog state machine using scoped styles.

**Verification:** inspect every screenshot required by section 13 and complete keyboard workflows.

## Task 11: End-to-end completion gate

Run this exact packaged-extension workflow:

1. create Vault A using device-only onboarding;
2. Capture two pages, mark one Deleted, and leave it un-Vacuumed;
3. create Vault B and prove it has an independent device slot and no passphrase slot;
4. return to and unlock Vault A on the device;
5. start Export and prove Vault B records never enter its snapshot;
6. attempt Capture, Rename, Lock, Switch, Delete, and Vacuum during Export and prove UI disablement
   plus Runtime `VAULT_BUSY` enforcement;
7. cancel during Package and prove no download, no temp file, and unchanged source records;
8. restart a second Export, complete Save As, and capture the `.awsm` file;
9. parse the readable Manifest without a passphrase and prove it exposes only approved operational
   metadata, includes the Deleted Capture, and omits Vault name and content;
10. validate the package with the correct passphrase;
11. prove a wrong passphrase and one-bit mutations fail with the correct stable error class;
12. prove no Projection, cache, local slot, Job, outcome, or other Vault record exists in the
    archive;
13. keep popup and two Library surfaces open and prove busy, progress, cancellation, and success
    update without reload; and
14. run Vault Vacuum, export again, and prove the previously Deleted Capture is absent only from the
    post-Vacuum package.

---

# 12. Required Verification Commands and Audits

Discover commands from manifests if they change. With the current repository, completion requires:

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:e2e:chrome
git diff --check
```

Run documentation checks:

```bash
rg -n '^\*\*(Document|Version|Status|Owner|Depends On):' docs
rg -n '\b(MUST|SHALL|SHOULD|MAY)\b' docs/specifications
rg -n '\b(Export|Import|Backup|Restore|passphrase|Passphrase)\b' ROADMAP.md docs README.md VISION.md
```

Run source audits:

```bash
rg -n 'passphraseSlot|hasPassphraseSlot|UnlockPassphrase|WRONG_PASSPHRASE' apps/browser-extension
rg -n 'listStoredObjects\(\)|listStoredEvents\(\)|zipSync|unzipSync|base64' apps/browser-extension/src
rg -n 'export_jobs|ExportVault|CancelVaultExport|VAULT_BUSY' apps/browser-extension/src
rg -n 'console\.(log|info|warn|error)|diagnostic|error.*passphrase' apps/browser-extension/src
```

Expected audit outcomes:

- no local passphrase-slot or passphrase-unlock match remains;
- Export does not use whole-Vault list methods, synchronous whole-package ZIP methods, or base64;
- every authoritative mutation transaction checks the Export lease;
- passphrases, names, URLs, and decrypted metadata never enter logging/error details; and
- existing base64 use is limited to unrelated screenshot/UI flows and is not copied into Export.

Before committing implementation, inspect ignored files and confirm `.awsm` packages, OPFS/test
downloads, browser profiles, test results, secrets, and evidence screenshots are excluded unless a
small non-secret fixture is intentionally checked in.

---

# 13. Rendered Visual Inspection Matrix

Capture and inspect at least 1280x800 and 390x844 for:

1. unlocked Library with enabled `Export Vault`;
2. locked Library with disabled Export;
3. busy Library with disabled conflicting controls;
4. initial dialog with both empty password fields;
5. first-field focus;
6. confirmation mismatch;
7. too-short passphrase;
8. Running/Verify progress;
9. Running/Package progress;
10. cancellation requested;
11. safe failure with Close action;
12. success with restored Library focus and announcement;
13. popup while Export is running; and
14. management-row wrapping at narrow width.

For every image, inspect alignment, shared content-grid edges, spacing cadence, readable labels,
password-control dimensions, focus treatment, error placement, wrapping, clipping, overflow,
disabled prominence, and unintended Library movement. Automated DOM existence without visibility and
geometry assertions is insufficient.

---

# 14. Acceptance Criteria

The feature is complete only when all statements are true:

1. Local Vault creation and unlock contain no persistent passphrase option or code path.
2. Every local Vault Root Key remains protected by one non-exportable device slot.
3. An unlocked active Vault can produce one complete encrypted `.awsm` Vault Package offline.
4. Every package requires a fresh export passphrase meeting the canonical policy.
5. The Export passphrase never becomes a local Vault unlock method and is never persisted or logged.
6. The package includes exact active Generation reachability, including un-Vacuumed Deleted history.
7. Existing authoritative Object and Event bytes are unchanged.
8. No Projection, Materialization, cache, local key/slot, Job, outcome, Workspace state, or diagnostic
   appears in the package.
9. The readable Manifest exposes only the approved operational metadata and never the Vault name or
   content.
10. The Export Key Envelope and Manifest are mutually bound and resist wrong-passphrase,
    cross-package, and cross-Vault substitution.
11. The strict validator authenticates every Generation, Event, Bundle, dependency, checksum, and
    replay result without writing a destination Vault.
12. ZIP64 generation and validation stream through OPFS without whole-Vault buffering or base64.
13. Export blocks every conflicting mutation and context change at the transaction boundary.
14. Cancellation works during Verify, Package, and Download and removes temporary output.
15. Interrupted Export fails safely on restart without a resumable secret or stale busy lease.
16. Chrome always opens Save As with a neutral dated filename and success means download completion.
17. Popup and multiple Library surfaces show live Export busy/progress/terminal state without reload.
18. All required visual states have been rendered and inspected at desktop and narrow widths.
19. Owning documentation describes one canonical device-only local model and one canonical initial
    Export format.
20. Unit, integration, typecheck, lint, build, release-manifest, packaged Chrome E2E, source-audit,
    and `git diff --check` gates pass.

---

# 15. Explicitly Deferred

Do not add any of the following while implementing this plan:

- Complete Import or any destination-Vault writes, which are owned by Plan 07;
- Merge Into Existing Vault or Read-Only Inspection Import modes;
- partial Export by Capture, Collection, date, tag, or folder;
- plaintext, MHTML-directory, JSON, Markdown, or other human-readable Export;
- Backup Sets, Snapshots, retention, scheduled Backup, Restore, or disaster-recovery automation;
- synchronization, Accounts, Account passwords, Account Recovery Keys, Account Encryption
  Keys, trusted-Device enrollment, sharing, or server storage;
- local Vault passphrase slots, passphrase unlock, passphrase change, or passphrase recovery;
- root-key rotation, Secure Scrub, export destruction, or revocation of already exported packages;
- importing a package as a continuously synchronized replica;
- compression or library-managed ZIP encryption;
- multiple package formats, compatibility aliases, legacy readers, migrations, upgrade branches, or
  version negotiation; or
- broader generic Job Framework refactoring beyond the interfaces required to make Export a durable
  Runtime Job.
