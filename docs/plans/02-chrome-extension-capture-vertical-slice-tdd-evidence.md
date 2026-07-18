# Chrome Extension Capture Vertical Slice — TDD Evidence

**Document:** `docs/plans/02-chrome-extension-capture-vertical-slice-tdd-evidence.md`

**Status:** Implementation Record

**Last Updated:** 2026-07-18

**Implements:** `docs/plans/02-chrome-extension-capture-vertical-slice.md`

## Purpose

This record preserves the RED-before-GREEN history for the vertical slice. The checkout began without source files, manifests, or a test harness and is not a Git worktree, so this document is the durable implementation log requested by section 2 of the plan. Final command results must still be rerun; this record is not a substitute for the section 12 acceptance audit.

## Behavior cycles

| Task                         | RED evidence observed before production behavior                                                                                                                                                                                                                                                                                   | GREEN evidence                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Workspace and shell       | The focused Runtime descriptor test failed because `src/runtime/version.ts` did not exist.                                                                                                                                                                                                                                         | `tests/unit/runtime-version.test.ts` passed; strict typecheck and the first WXT Chrome MV3 build passed.                                                                                                                                                                                                                                                   |
| 2. Schemas and decoders      | Decoder tests rejected the absent implementations for Commands, storage records, versions, URLs, identifiers, duplicate Artifact IDs, and unknown error shapes.                                                                                                                                                                    | `tests/unit/domain-decoders.test.ts` and `tests/unit/capture-job-decoder.test.ts` passed through public decoders.                                                                                                                                                                                                                                          |
| 3. Canonical formats         | Golden and mutation tests initially had no canonical descriptor, Artifact reference, structured-content, or framed-encryption implementation.                                                                                                                                                                                      | Descriptor, Artifact graph, structured-content, and Artifact-envelope suites pass canonical round-trip, checksum, framing, ordering, limit, and malformed-input assertions.                                                                                                                                                                                |
| 4. Cryptography              | HKDF, XChaCha20-Poly1305, and Argon2id vector tests failed before their helpers existed; mutation tests had no authenticated envelope reader.                                                                                                                                                                                      | `tests/unit/crypto.test.ts` passed fixed vectors, domain separation, envelope mutation, and authentication failures. A regression cycle also exposed and fixed typed-array ownership returned by libsodium.                                                                                                                                                |
| 5. Vault lifecycle           | Vault tests failed before the device slot, verifier authentication, manual lock persistence, and atomic creation existed.                                                                                                                                                                                                          | `tests/unit/vault.test.ts` passed create, auto-unlock, manual lock, corrupt-slot, verifier, and onboarding rollback cases; the real-browser `vault` integration scenario proved the stored AES-KW device key is non-exportable.                                                                                                                            |
| 6. IndexedDB and atomicity   | Real-browser scenarios failed before the schema and Driver existed; rollback and reconciliation assertions initially had no transaction implementation.                                                                                                                                                                            | Six Playwright IndexedDB scenarios passed immutable insertion, identical duplicate acceptance, conflict rejection, atomic registration/idempotency, rollback, Projection clearing, and interrupted-job reconciliation.                                                                                                                                     |
| 7. Preflight and MHTML       | Host tests failed before URL/permission/API checks and mandatory Blob acquisition existed. Real Chrome then exposed a failing Blob-lifetime regression when bytes were read after the `saveAsMHTML` callback returned.                                                                                                             | `tests/unit/capture-host.test.ts` passed all preflight and empty/rejected/unreadable MHTML cases. The Chrome Host now takes ownership of MHTML bytes inside the native callback, and packaged-Chrome E2E validates real MHTML content.                                                                                                                     |
| 8. Full-page screenshot      | Geometry/lifecycle tests failed before tiling, throttling, fixed-element mitigation, stitching, limits, warnings, and restoration existed. The strengthened E2E landmark assertion then failed while its samples landed on black fixture labels.                                                                                   | `tests/unit/screenshot.test.ts` passed ten geometry and failure-path cases. The E2E test samples decoded pixels away from labels and proves a 1280×2100 red/green/blue capture with the fixed header appearing once.                                                                                                                                       |
| 9. Registration and recovery | Runtime/registration tests failed before Bundle encryption and atomic commit orchestration. Interruption cases initially lacked reconciliation. On 2026-07-16, `vitest run tests/unit/library-projection.test.ts` failed with `Cannot find module '../../src/runtime/library/projection'`, proving the duplicate-Event replay gap. | Capture Runtime and registration tests passed mandatory-failure, screenshot-warning, size, idempotency, and commit-boundary cases. Real IndexedDB interruption scenarios passed. After adding the reducer and using it during registration, the focused Projection replay suite passed 2/2 and proves duplicate Event IDs do not duplicate or mutate rows. |
| 10. UI and offline library   | Popup/library tests and packaged E2E failed before UI entrypoints existed. Real Chrome cycles exposed missing sodium WASM CSP, MHTML Blob lifetime, premature image sampling, samples placed on label text, and a fixture favicon 404.                                                                                             | Popup state tests, library corruption tests, keyboard onboarding, popup-close continuity, offline list/detail/screenshot, plaintext storage audit, safe MHTML download, non-execution checks, and zero-console-error E2E passed in packaged Chrome for Testing.                                                                                            |
| 11. Security/release gate    | On 2026-07-16, `node scripts/verify-release.mjs` failed with `MODULE_NOT_FOUND`, before the verifier existed. The first lint run then failed on the new verifier and changed files, providing the formatting gate RED.                                                                                                             | `pnpm build` now runs `scripts/verify-release.mjs`; it passed exact permission order, absent host permissions, Chrome 116, restricted CSP, no remote HTML/CSS assets, no remote imports, and no prohibited storage APIs. `pnpm lint` subsequently passed all 79 checked files.                                                                             |

## Notable regression cycles

- A MHTML callback returned a Blob that became unreadable after callback completion. The regression failed in real Chrome before byte ownership moved inside the callback.
- Sodium WASM was blocked by the original extension CSP. The packaged extension failed before narrowly adding `wasm-unsafe-eval`; general `unsafe-eval` remains prohibited and build-verified.
- Error-path byte wiping could mask the primary failure when sodium initialization was unavailable. Regression tests established direct byte filling as the canonical error-path wipe behavior.
- Screenshot final-tile geometry initially cropped the wrong source area on clamped final scroll positions. Geometry tests failed before source offsets were derived from requested tile position minus actual scroll position.
- Background message handling initially claimed unrelated offscreen messages with an asynchronous `undefined` response. The stitch probe failed before invalid app messages returned synchronously.

## Final verification record

Final clean run on 2026-07-16 against the final files:

```text
pnpm lint            PASS — 79 files checked
pnpm typecheck       PASS
pnpm test            PASS — 77 tests in 14 files
pnpm build           PASS — WXT build plus release/security verifier
pnpm test:integration PASS — 8 real-browser IndexedDB tests
pnpm test:e2e        PASS — 2 packaged-Chrome tests
pnpm test:e2e:chrome PASS — 2 packaged-Chrome tests
```

The browser commands use the full Playwright Chrome for Testing binary (Chrome 149 in this environment), not a DOM emulator. The E2E-only extension copy adds host access because headless Chrome cannot synthesize the toolbar gesture that grants `activeTab`; the shipping build is separately verified to have no host permissions. The test invokes `chrome.action.openPopup()` and exercises the packaged `popup.html` UI. The disposable manifest modification never touches `.output/chrome-mv3`.

## Section 12 acceptance audit

|   # | Result | Authoritative evidence                                                                                                                                                                                                                                                                   |
| --: | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 |  PASS  | `vault.test.ts` and packaged Chrome cover device-only local creation and unlock; no persistent local passphrase credential exists.                                                                                                                                                       |
|   2 |  PASS  | Vault tests inspect wrapped slots; the real-browser integration test proves the persisted AES-KW device key is non-exportable; the E2E storage audit finds no unwrapped key or sensitive plaintext.                                                                                      |
|   3 |  PASS  | The built manifest declares the toolbar action; packaged Chrome successfully invokes `chrome.action.openPopup()`, dispatches through packaged `popup.html`, and captures the local HTTP fixture.                                                                                         |
|   4 |  PASS  | Capture Host and Runtime tests reject missing, empty, unreadable, and rejected MHTML and prove no registration occurs; E2E downloads real Chrome MHTML containing `MIME-Version: 1.0`.                                                                                                   |
|   5 |  PASS  | Screenshot lifecycle tests prove best-effort warnings/restoration; popup tests prove the warning is visible; E2E proves a stitched 1280×2100 lossy WebP with red/green/blue landmarks. Manifest verification rejects unapproved permissions and confirms there is no `debugger`.         |
|   6 |  PASS  | Descriptor, Artifact graph, structured-content, and Artifact-envelope tests prove deterministic canonical output and strict validation before registration.                                                                                                                              |
|   7 |  PASS  | Registration uses separately derived authenticated-encryption contexts for Bundle Descriptor, Artifact, Event, and Projection. E2E inspects IndexedDB and rejects URL, title, MHTML, and fixture-text plaintext.                                                                         |
|   8 |  PASS  | The real-browser atomic scenario observes one descriptor plus five Artifact Object records, one Event, one Projection, and one command outcome; forced conflicts prove transaction rollback.                                                                                             |
|   9 |  PASS  | Real IndexedDB repeated-command registration retains counts of one in all four stores; duplicate-Event replay tests retain one unchanged library row.                                                                                                                                    |
|  10 |  PASS  | A packaged-Chrome E2E test stops the actual MV3 worker while the job is Running, restarts it, observes `CAPTURE_INTERRUPTED`, and directly verifies `[0,0,0,0]` authoritative store counts. Commit-boundary integration tests also prove post-commit reconciliation without duplication. |
|  11 |  PASS  | E2E disables networking before opening the library, then lists and opens metadata/screenshot and downloads verified MHTML.                                                                                                                                                               |
|  12 |  PASS  | E2E asserts no `iframe`, `object`, or `embed`, proves live fixture script state is absent from the library, and only creates the MHTML Blob URL from the download action.                                                                                                                |
|  13 |  PASS  | Public Host-contract tests reject restricted schemes and missing tabs before any acquisition or commit.                                                                                                                                                                                  |
|  14 |  PASS  | The build verifier reads the shipping manifest and enforces exactly `activeTab`, `scripting`, `pageCapture`, `offscreen`, and `unlimitedStorage`, with no host or optional-host permissions.                                                                                             |
|  15 |  PASS  | Every command listed in Task 11 passed in the final clean run above; the additional real-browser integration suite also passed.                                                                                                                                                          |
|  16 |  PASS  | The task-by-task table in this document records each observed RED reason and corresponding GREEN evidence, including the final replay, release-verifier, MHTML, screenshot, and worker-interruption regression cycles.                                                                   |

All sixteen acceptance criteria have direct passing evidence. No backend, network service, account, Firefox implementation, or deferred feature was added.

## Post-implementation polish cycle

The recent-capture card described in plan section 14 followed an additional RED-GREEN cycle:

- **RED:** `vitest run tests/unit/popup-view.test.ts tests/unit/capture-job-decoder.test.ts` failed 2/2 new behaviors. The popup returned only `{ screen: "ready" }`, and the storage decoder discarded `noticeDismissed`.
- **GREEN:** the focused suite passed 8/8 after adding the recent-capture state model and additive operational dismissal flag.
- **Persistence:** the seventh real-browser IndexedDB scenario passed after dismissing a completed job and reopening it with `noticeDismissed: true`.
- **Packaged Chrome:** E2E passed after asserting `Archived: AWSM tall fixture`, a labeled screenshot thumbnail, the accessible dismiss button, immediate removal, and continued absence after popup close/reopen.
- **Privacy:** dismissal stores only a Boolean on the opaque operational job. The title and screenshot are decrypted from the existing encrypted Projection/Bundle only while the Vault is unlocked and are never added to plaintext persistence.

### Grouped Library

- **RED:** the focused Library test failed with `TypeError: groupLibraryItems is not a function` before normalized page grouping existed.
- **GREEN:** the Library suite passed with fragment-insensitive page keys, newest-first histories, and latest-capture group metadata.
- **Packaged Chrome:** E2E archived the same fixture twice, displayed one card with `2 captures` and the latest screenshot thumbnail, opened the newest immutable version while offline, and downloaded its MHTML.
- Section 15 deletion/restoration/Vacuum is the canonical lifecycle exercised by the evidence below.

### Collection visualization and per-capture thumbnails

- **RED:** `vitest run tests/unit/library-view.test.ts` failed because `src/ui/library-view.ts` did not exist before collection routing and layer selection were implemented.
- **GREEN:** the focused suite passed direct-detail routing for a single capture, history routing for multiple captures, and selection of the three newest distinct Bundle IDs for visual layers.
- **Actual versions:** the Library protocol now associates a decrypted screenshot thumbnail with each capture’s Bundle ID. The stack and history resolve images by that identity instead of reusing the group’s latest image.
- **Packaged Chrome:** E2E changed the fixture from a red first version to a purple second version, then proved the stacked collection contains two distinct image sources and the history contains two per-capture thumbnails.
- **Accessibility:** older decorative stack layers are hidden from the accessibility tree; the front thumbnail retains a descriptive label, and capture count/history remain textual.

## Section 15 deletion, restoration, and Vault Vacuum cycle

### Intentional RED evidence

- The first focused Library Projection run failed before `status`, `CapturesDeleted`, and `CapturesRestored` reducer support existed.
- After generation zero became mandatory, the focused Vacuum suite failed 2/2 because its repositories still returned no active head. This proved Vacuum no longer inferred a pre-release generation.
- After retained-history verification was added, the successful Vacuum test failed because the initial reducer incorrectly counted a deleted registration as retained. The branch was corrected before the suite returned green.
- The first packaged-Chrome run after replacing the canonical database name failed at direct IndexedDB inspection, identifying five stale test references to the discarded pre-release database.

### Deletion and restoration evidence

- Unit Projection tests prove Active → Deleted → Active transitions, duplicate Event idempotency, first-accepted conflict behavior, explicit multi-ID state changes, and survival of a later same-page capture outside a collection snapshot.
- Runtime preparation rejects empty, duplicate, missing, and contradictory selections before
  commit. The Driver commits the encrypted Event and every affected encrypted Projection row in one
  transaction while retaining Bundle Descriptor and Artifact Objects.
- Packaged Chrome deletes and restores a two-capture collection, deletes and restores one capture, preserves distinct Deleted thumbnails and offline detail, then deletes that capture again for Vacuum. Dismissed delete, restore, and Vacuum confirmations leave state unchanged.

### Generation, verification, and crash-safety evidence

- Vault creation atomically persists encrypted generation zero and its active head with Vault metadata and key slots. Each later authoritative commit atomically records opaque Object/Event IDs in the active append tail; Vacuum verifies manifest base plus tail exactly matches storage and folds retained entries into its successor. The canonical database is `awsm-vault`.
- Vacuum acquires a persisted opaque lease before snapshotting. Capture/delete/restore transactions reject writes while that lease exists. Startup clears only abandoned pre-activation leases; activation, Projection publication, collection, generation replacement, head CAS, and lease removal share one IndexedDB transaction.
- Unit tests prove unsupported Objects/Events fail before commit, retained Event replay must equal the pre-Vacuum Active Bundle set, mixed lifecycle Events receive new IDs while filtering deleted references, failed work releases its lease, and a successful successor manifest is encrypted, checksummed, increments the generation, preserves the Vault ID, records only a scalar predecessor, and retains only Active Objects and Events.
- Real-browser integration proves a late transaction failure rolls back every deletion, a source-generation CAS conflict activates nothing, and an abandoned pre-activation lease blocks writes until restart reconciliation.
- Packaged Chrome proves Object counts decrease, the predecessor manifest is collected, Deleted becomes empty, and the retained capture still opens its authenticated full screenshot offline.

### Explicit boundaries and deferrals

- The browser slice performs local activation and local garbage collection only. Remote propagation is deferred; focused contract fixtures/tests prove opaque generation fields round-trip, superseded submissions return `VAULT_GENERATION_SUPERSEDED`, and superseded Backup Sets route to isolated recovery rather than merge.
- Vault Vacuum does not inspect or delete old Backup Sets, exports, or offline replicas and is not Secure Scrub or cryptographic erasure.
- Storage-pressure suggestion policy remains optional (`MAY`) and is not implemented by the current Chrome Host.

### Section 15 final verification record

Clean run on 2026-07-18 against the canonical pre-release database and final files:

```text
pnpm lint             PASS — 89 files checked, no fixes required
pnpm typecheck        PASS
pnpm test             PASS — 93 tests in 17 files
pnpm test:integration PASS — 11 real-browser IndexedDB tests
pnpm test:e2e         PASS — 2 packaged-Chrome tests
pnpm build            PASS — WXT build plus release/security verifier
```

The section 15 E2E path covers collection delete/cancel/restore, individual delete/restore/re-delete, the collapsed-by-default Deleted accordion below Library, its count/human-readable storage sizes/thumbnails/offline detail/MHTML download, Vacuum cancel/confirmation, physical Object-count reduction, generation replacement, empty Deleted, and retained offline screenshot verification. The local crash boundary is proven in Chromium IndexedDB: failed collection aborts entirely, stale CAS activates nothing, and an abandoned pre-activation lease blocks writes until safe startup reconciliation.

## Section 16 Collection Management Cycle

### Intentional RED evidence

- The first Collection-model run failed because `runtime/library/collections.ts` did not exist. It established the RED for stable assignment, exact fragmentless URL matching, deterministic routing, redirects, and grouping.
- The first Projection run failed three new membership assertions before `collectionId` and `CapturesMoved` replay were implemented.
- The management preparation run failed because `runtime/library/management.ts` did not exist. It established the RED for Merge, Move, Extract, compensating Undo, and stale-state validation.
- Capture routing initially generated a fresh Collection ID instead of reusing the exact matching Active Collection; the Runtime port and deterministic selector made it green.
- The real-browser integration run failed before the Driver exposed an atomic Collection-operation transaction.
- UI-model tests failed before destination eligibility, drop interpretation, and known-address ordering existed.
- The first packaged-Chrome drag test retained two cards because drag-over rejected the browser's protected transfer data. Drop validation was moved to the drop boundary while drag-over only advertises eligibility.
- Vacuum initially rejected `CapturesMoved` as unsupported, proving management history could not be silently discarded.
- Projection rebuild initially failed because `runtime/library/rebuild.ts` did not exist.

### Focused GREEN evidence

- Pure Collection, management, capture-routing, Projection, UI-model, Vacuum, and rebuild suites pass with immutable Event-backed assignments and exact compensating operations.
- The real-browser integration suite passes 12 scenarios, including one-transaction Event/item/topology/head persistence and replacement of disposable Library Projections.
- Packaged Chrome passes both scenarios with accessible Extract and Move controls, native Collection drag-to-Merge, Undo, offline rendering, deletion, restoration, and Vault Vacuum.
- Documentation now has one owning `vault/collection.md` specification and reconciled glossary, Event/Command, Runtime capture, Projection, history-rewrite, Vacuum, consistency-review, and testing contracts.

### Section 16 final verification record

Clean run on 2026-07-18 against the canonical pre-release format and final files:

```text
pnpm lint             PASS — 95 files checked, no fixes required
pnpm typecheck        PASS
pnpm test             PASS — 113 tests in 20 files
pnpm test:integration PASS — 12 real-browser IndexedDB tests
pnpm test:e2e         PASS — 2 packaged-Chrome tests
pnpm build            PASS — WXT build plus release/security verifier
```

The packaged path extracts a selected Capture, undoes it, extracts again, merges by native drag and drop, undoes the merge, and moves through the accessible destination picker before continuing through offline detail, deletion, restoration, and Vacuum. The final Vacuum retains authenticated Active content and accepts the Collection management Event history.

## Lossy Screenshot Canonicalization

- **RED:** focused Bundle and screenshot lifecycle tests failed when they first required `image/webp`, `screenshot-full.webp`, and WebP result fields while the implementation still emitted PNG.
- **GREEN:** the offscreen Host now stitches Chrome's transient PNG viewport tiles and encodes the persisted full screenshot as WebP at quality 0.72 and its bounded thumbnail as WebP at quality 0.68. MHTML remains the mandatory high-fidelity Artifact.
- WebP is the sole persisted screenshot representation exercised by this evidence.
- Packaged Chrome verifies successful WebP decode, full-page dimensions and landmarks, distinct per-Capture thumbnails, offline detail, and the existing encrypted-at-rest boundary.

### Oversized screenshot and thumbnail refinement

- **RED:** geometry and lifecycle tests failed while oversized pages still produced `SCREENSHOT_TOO_LARGE` without screenshot bytes; packaged Chrome separately reported the old 320×180 thumbnail instead of 640×360.
- **GREEN:** oversized screenshots retain native resolution from the top-left through the 16,384-pixel boundary and persist with `SCREENSHOT_TRUNCATED`. Library thumbnails are 640×360 WebP at quality 0.78.

## Recent Capture Lifetime Refinement

- **RED:** the focused popup-state test failed before fragmentless active-URL matching existed. The prior popup `pagehide` approach could also lose its asynchronous dismissal when Chrome destroyed the popup document.
- **GREEN:** the popup reports its visible Job over a named Runtime port; background port disconnect persists dismissal independently of the closing document. Background state suppresses and dismisses a recent Capture whenever the active tab is missing, invalid, or differs after fragment removal, while query parameters remain significant.
- Explicit dismissal, preview navigation, and Open Library still persist the same additive operational Boolean and clear the port target before the popup closes.
- Packaged Chrome proves closing a popup that actually rendered the preview prevents it from returning, and changing only the active page's query suppresses and persists dismissal of the stale preview.

## Drag Hotspot Refinement

- **RED:** the focused Library-view test failed before drag ghosts could derive a hotspot from the pointer and source bounds.
- **GREEN:** Collection and Capture ghosts preserve the clamped source-relative pointer coordinate, use it as the native drag-image hotspot, and rotate around that same point. The stationary card remains unrotated and eligible merge targets retain their separate highlight.
