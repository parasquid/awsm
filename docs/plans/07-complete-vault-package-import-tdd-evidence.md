# Complete Vault Package Import TDD Evidence

**Document:** `docs/plans/07-complete-vault-package-import-tdd-evidence.md`
**Status:** Implementation evidence
**Owner:** Engineering
**Last Updated:** 2026-07-19
**Depends On:** `docs/plans/07-complete-vault-package-import.md`

---

# Evidence Log

## Task 1: Canonical Import contracts and store

### RED

- Added application-protocol coverage for the five Workspace-scoped Import requests and strict
  rejection of malformed or Vault-scoped variants.
- Added persisted Import Job decoding coverage for canonical acquisition/execution states,
  progress bounds, state/stage/identity invariants, forbidden secret fields, and terminal errors.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- app-protocol.test.ts import-job.test.ts`
- Expected failure: Import requests, `decodeImportJob`, and Import error identifiers do not exist.

### GREEN

- Added the canonical application requests/results, Import error identifiers, persisted Job/store
  schema, and strict Import Job decoder with progress and state invariants.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- app-protocol.test.ts import-job.test.ts`
- Result: 35 test files passed; 166 tests passed.

## Task 2: Workspace Import lease

### RED

- Added a real Chromium scenario requiring a single Workspace-scoped Import lease to reject a
  second Import plus Capture acquisition, atomic registration, Vacuum, Export, and manual Lock.
- Command: `corepack pnpm test:integration`
- Expected failure: `IndexedDbImportRepository` and transaction-level Import fencing do not exist.

### GREEN

- Added the canonical workspace Import repository and store-backed active lease.
- Added storage-level fencing for Capture acquisition/registration, Vacuum, Export, and manual
  Lock, with cancellation releasing the lease.
- Command: `corepack pnpm test:integration`
- Result: 27 Chromium integration tests passed.

## Task 5: Shared validator result and Complete boundary

### RED

- Extended the existing Artifact graph Export test to require the shared validator to return the
  exact Generation, head, stored Events/Objects, current Vault name, and original creation time.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- vault-export-artifacts.test.ts`
- Expected failure: the validator currently returns only the Manifest and Root Key.

### GREEN

- Refactored the shared authoritative validator to return the exact validated Generation, head,
  stored Events/Objects, current Vault name, and original creation time while preserving existing
  Complete and Selective Export validation behavior.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- vault-export-artifacts.test.ts`
- Result: 35 test files passed; 166 tests passed.

## Task 7: Encrypted Artifact preparation

### RED

- Extended the real Chromium ArtifactStore scenario to require byte-identical encrypted wrapper
  preparation and rejection/cleanup of a truncated encrypted wrapper.
- Command: `corepack pnpm test:integration`
- Expected failure: `ArtifactStore.prepareEncrypted` does not exist.

### GREEN

- Added `ArtifactStore.prepareEncrypted` with streamed OPFS writes, incremental SHA-256/length
  binding, exact byte preservation, collision rejection, and failure cleanup.
- Command: `corepack pnpm test:integration`
- Result: 27 Chromium integration tests passed.

## Task 4: Bounded source staging

### RED

- Added a real Chromium scenario requiring a 700,000-byte encrypted package to stage in OPFS with
  monotonic progress, exact recovered bytes, and explicit cleanup.
- Command: `corepack pnpm test:integration`
- Expected failure: `ChromeVaultImportHost` does not exist.

### GREEN

- Added the shared Chrome Host with bounded OPFS streaming, Job-derived temporary paths,
  monotonic byte progress, exact-size verification, and scoped cleanup.
- Command: `corepack pnpm test:integration`
- Result: 28 Chromium integration tests passed.

## Tasks 6 and 10: Import Job transitions, cancellation, and restart

### RED

- Added a real IndexedDB scenario requiring monotonic acquisition, independent staging-size
  completion, retryable authentication, authenticated execution progress, idempotent cancellation,
  terminal restart interruption, and lease release.
- Command: `corepack pnpm test:integration`
- Expected failure: the Import repository exposes only lease acquisition and cancellation.

### GREEN

- Added strict persisted transitions for acquisition, authentication retry/success, execution
  progress, idempotent cancellation, and restart reconciliation.
- Command: `corepack pnpm test:integration`
- Result: 29 Chromium integration tests passed.

## Task 8: Local credentials and prepared Projections

### RED

- Extended production package coverage to require a fresh Device identity, non-exportable device
  key, new slot/verifier, preserved Generation/head, and a callback-scoped raw Root Key that is
  wiped on exit.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- vault-export-artifacts.test.ts`
- Expected failure: authenticated callback and imported credential preparation do not exist.

### GREEN

- Added callback-scoped authenticated validation, fresh locked local credential preparation,
  sequential wrapper preparation, and side-effect-free Projection preparation.
- Command: `corepack pnpm --filter @awsm/browser-extension test -- vault-export-artifacts.test.ts`
- Result: 35 test files passed; 166 tests passed.

## Task 9: Atomic activation and collision safety

### RED

- Added a real IndexedDB scenario requiring one activation transaction, empty-Workspace selection,
  locked metadata, exact authoritative rows, terminal Job success, and collision rejection.
- Command: `corepack pnpm test:integration`
- Expected failure: `commitVaultImport` does not exist.

### GREEN

- Added strict scope/identity/progress checks and one transaction across all required Workspace,
  Vault, authoritative, Projection, credential, and Import Job stores.
- Command: `corepack pnpm test:integration`
- Result: 30 Chromium integration tests passed.

### Atomic rollback extension

- Injected a synchronous failure at each of the 14 destination activation writes, including the
  terminal Import Job update, and proved every attempt retained the Running Job while leaving the
  Workspace selection, Vault directory, authority, and Projections absent.
- Command: `corepack pnpm test:integration`
- Result: 30 Chromium integration tests passed; 14 of 14 activation failure points rolled back.

## Tasks 3 and 11: Entry points, live UI, and terminal experiences

### RED

- Added packaged-extension assertions for `Import existing Vault` on first launch and `Import Vault`
  in populated Library management.
- Command: `corepack pnpm --filter @awsm/browser-extension test:e2e`
- Expected failure: neither rendered entry control exists.

### GREEN

- Added the shared Library-owned Select/Acquire/Authenticate flow, wrong-passphrase retry, live Job
  progress/cancellation, background handoff, terminal state, popup deep link, and no-Vault choices.
- Command: `corepack pnpm --filter @awsm/browser-extension test:e2e`
- Result: the three matched packaged-extension scenarios passed.

### Live and terminal-state extension

- Kept two Library pages open while a first-launch Import moved through Acquire and Authenticate;
  the observing surface refetched canonical Job state, exposed cancellation, and updated to the
  imported Vault without reload.
- Cancelled acquisition from the second surface, proved the initiating dialog closed and a new Job
  could stage the same package again, then completed Import.
- Exercised real duplicate-Vault, authenticated Selective, and invalid-package failures. Collision
  and Selective retained their stable public IDs after authentication; malformed bytes remained a
  pre-authentication package failure.
- Exercised success with an existing active Vault, proved its selection remained unchanged, and
  used the rendered `Switch to imported Vault` action to enter the locked imported Vault.

## Task 12: Cold portability and visual inspection

### RED

- Added a fresh-Workspace production Export-to-Import test with wrong-passphrase retry and locked
  post-commit state.
- Command: `corepack pnpm exec playwright test -c playwright.e2e.config.ts --grep "exports a Vault and imports"`
- Expected failure: the Import dialog and Runtime execution path do not exist.

### GREEN

- The production Export service/package writer generated the encrypted source; a clean browser
  profile staged, authenticated, imported, activated, and exposed device unlock.
- Command: `LD_LIBRARY_PATH=.output/browser-libs corepack pnpm exec playwright test -c playwright.e2e.config.ts --grep "exports a Vault and imports"`
- Result: 1 portability test passed.
- The package contains a registered Bundle, PRIMARY, TEXT_EXTRACTED, and CONTENT_STRUCTURED
  Artifacts, a Collection identity, and a warning. After Import, the test unlocked through the new
  device slot, browsed the rebuilt item/detail state, and inspected decrypted text from the copied
  wrapper.
- The imported Vault then entered the production Export flow. Its authority was enumerated,
  repackaged, and passed the shared validator before reaching the Download stage; headless Chromium
  intentionally cannot complete the interactive `saveAs` prompt, so the test asserts the exact
  terminal `EXPORT_DOWNLOAD_FAILED` boundary rather than claiming a downloaded file.
- Inspected at original resolution the Select states before/after file selection, live 32 MiB
  Acquire state, Authenticate resting/focused state, wrong-passphrase alert, cancellation
  restoration, Validate/Prepare/Rebuild/Commit management states, invalid/Selective/collision/quota
  failures, empty-Workspace success, and existing-active success/switch action. Evidence is emitted
  as `import-*.png` by the portability E2E test at 1,280 px and 390 px widths.
- Visual review found and corrected stale post-unlock copy, missing empty-Workspace Job status,
  enabled Unlock/Library mutation controls during Import, unclear disabled-control treatment, and
  post-authentication terminal failures remaining in the secret-entry dialog.

## Streaming, quota, and security extensions

- Added a logical 4 GiB-plus source-stream test that retains one 1 MiB transfer chunk, reports
  strictly monotonic progress, and writes exactly 4,097 chunks without proportional allocation.
- Injected OPFS `QuotaExceededError` at writable creation for both source staging and prepared
  Artifact installation; each maps to `STORAGE_QUOTA_EXCEEDED` and removes the newly created path.
- Propagated one AbortSignal through source copying, ZIP reads, authoritative validation, Artifact
  decryption/verification, second-pass wrapper copying, Projection preparation, and pre-commit
  checks. Failed consumers cancel their upstream readers to avoid backpressure deadlock.
- Added a shared-validator regression proving Import consumer/capability errors pass through rather
  than being reclassified as package corruption.
- Cleared the DOM passphrase immediately after dispatch and explicitly released UI, application,
  Runtime, and validator string references after key-envelope authentication or in `finally`.

## Final verification

- `corepack pnpm lint`: 137 files checked with no warnings or fixes.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm test`: 37 files and 169 tests passed.
- `corepack pnpm test:integration`: 30 real-Chromium tests passed.
- `corepack pnpm build`: production build and release static-security verification passed.
- Focused packaged-extension portability: 1 test passed, including retry, cancellation, Import,
  unlock, browse, re-export validation, collision, Selective rejection, malformed input, live
  surfaces, existing-active behavior, and the visual matrix.
- `corepack pnpm test:e2e`: all 4 packaged-extension scenarios passed.
- Prettier checked every changed Markdown file; `git diff --check` passed.
- The stale-language and prohibited-pattern searches were reviewed in context. Remaining
  `arrayBuffer()` and base64 uses are bounded ZIP-tail, compact thumbnail/text, screenshot-tile, or
  Artifact-chunk paths—not whole-package Import transfer.
- `ROADMAP.md` requires no edit: its remaining Import entries are limited to unresolved Selective
  Import, authenticated omission representation, and remote retrieval; Complete Import is not
  listed as future work.
