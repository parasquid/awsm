# Browser Storage Relief TDD Evidence

**Document:** `docs/plans/11-browser-storage-relief-and-remote-artifact-retrieval-tdd-evidence.md`

**Status:** Complete

**Owner:** Engineering

**Last Updated:** 2026-07-21

**Depends On:** `docs/plans/11-browser-storage-relief-and-remote-artifact-retrieval.md`

---

## Canonical contracts and state

- RED: `corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/storage-relief-contracts.test.ts`
  failed because the persisted decoders, App request parser, and Runtime error identifiers did not
  exist.
- GREEN: the same focused suite passed after adding the strict availability, Job, checkpoint, App
  request, and error contracts.
- RED: `corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/storage-relief-state.test.ts`
  failed because checkpoint transition and aggregation behavior did not exist.
- GREEN: the focused state suite passed after adding forward-only checkpoint transitions, Job
  transitions, immutable fences, and safe aggregate accounting.

## IndexedDB persistence and OPFS primitives

- RED: `corepack pnpm --filter @awsm/browser-extension exec tsc -p tests/integration/tsconfig.json`
  failed because `IndexedDbStorageReliefRepository` did not exist.
- GREEN: `corepack pnpm --filter @awsm/browser-extension exec playwright test tests/integration/indexeddb.browser.test.ts --project=chromium -g "storage-relief checkpoints|streams encrypted Artifact"`
  passed against browser IndexedDB and OPFS. The scenarios exercise schema creation, atomic Job and
  checkpoint persistence, estimate-drift rejection, rejected mismatched availability commits,
  restart decoding, cancellation persistence, remote-only marking and clearing, exact encrypted
  wrapper verification, and idempotent removal.
- Neighbor verification: the storage-relief contract/state suites and affected synchronization
  suites pass, and `corepack pnpm --filter @awsm/browser-extension typecheck` exits successfully.

## Artifact resolver and maintenance lease

- RED: `corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/artifact-resolver.test.ts`
  failed because the Runtime `ArtifactResolver` did not exist.
- GREEN: the Artifact resolver suites pass with local verification, remote-only local restoration,
  fresh-ticket quota fallback, bounded transient ciphertext and plaintext verification, offline
  separation, corruption rejection, and preservation of `RemoteOnly` after transient access.
- Browser evidence: the `storage-relief maintenance lease` Chrome integration scenario proves that
  active cleanup is reported as scoped management work and blocks Capture and Vacuum acquisition,
  while `WaitingForUnlock` releases the lease.

## Ordinary synchronization availability

- RED: the remote-only Upload regression opened OPFS before the server could return
  `AlreadyDurable`; the focused test observed one forbidden local open.
- GREEN: Upload now opens Artifact bytes lazily and rejects any unexpected byte request for a
  remote-only Object. The exact durable path records its checkpoint without an OPFS read.
- Pull selects the active-server stream for an existing `RemoteOnly` Artifact and the local stream
  for ordinary local availability. Newly prepared wrapper IDs clear only their matching
  availability rows in the same IndexedDB transaction that activates reconciliation.
- Real Chrome evidence: the remote-reconciliation scenario rejects both authority races, then
  commits a valid reconciliation and directly observes that the installed Artifact row was cleared
  while the unrelated `RemoteOnly` row remained.

## Storage-relief Job core

- RED: `corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/storage-relief-runner.test.ts`
  failed because the Runtime Job runner did not exist.
- GREEN: the Job runner suite proves that matching active-Generation Artifact metadata and the
  exact registered dependency closure become a persisted `Verified` checkpoint before OPFS
  removal, that `RemoteOnly` is committed only afterward, that mismatched server metadata retains
  the local wrapper with a stable skip reason, and that cancellation between proof and eviction
  retains the wrapper. The same suite resumes an `Evicting` checkpoint after the wrapper has
  already disappeared and commits the matching availability row without repeating deletion.
- RED: `corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/storage-relief-candidates.test.ts`
  failed because authenticated candidate enumeration did not exist.
- GREEN: candidate enumeration decrypts and authenticates the `BundleRegistered` Event and Bundle
  Descriptor closure, selects only local `PRIMARY` and `SCREENSHOT_FULL` wrappers, excludes compact
  and already-remote-only Artifacts, and safely accounts encrypted lengths beyond 4 GiB.
- Real Chrome evidence: `corepack pnpm --filter @awsm/browser-extension exec playwright test tests/integration/indexeddb.browser.test.ts -g "evicts a verified Artifact wrapper" --project=chromium`
  creates an encrypted wrapper in OPFS and a persisted Job in IndexedDB, performs the foreground
  synchronization/proof boundary, then directly observes the wrapper absent, its `RemoteOnly` row
  present, terminal `Succeeded` state, and nonzero freed-byte accounting.
- RED: the focused active-Generation proof and Job-creation suites initially failed because no
  strict metadata prover or Runtime start service existed.
- GREEN: the prover accepts only canonical committed record pages, includes the Vault Generation
  record, validates Event dependency metadata, rejects page or final-head Generation drift, and
  issues only `GET` metadata requests. The start service snapshots the local head and complete
  availability set, rejects a stale displayed estimate before creating a Job, and persists the
  immutable candidate ceiling through the atomic repository operation.
- Application wiring: `GetStorageReliefEstimate`, `StartStorageRelief`, and
  `CancelStorageRelief` now pass the strict top-level App decoder. Background execution suspends
  ordinary reconciliation, owns one foreground synchronization attempt, projects sanitized Job
  state, publishes durable invalidations, resumes Created/Running Jobs at startup, and resumes the
  named waiting states after unlock or login. Lock and logout abort with typed reasons before the
  next candidate; authentication expiry uses canonical credential erasure.
- Real Chrome fault evidence: `corepack pnpm --filter @awsm/browser-extension exec playwright test tests/integration/indexeddb.browser.test.ts -g "recovers every storage-relief interruption" --project=chromium`
  terminates execution after foreground synchronization, after `Verified`, after `Evicting`, after
  OPFS removal, and after the atomic `RemoteOnly` commit. Each case directly inspects the file,
  checkpoint, and availability row,
  closes and reopens IndexedDB, resumes the same Job, and finishes with exactly one remote-only
  wrapper and correct freed-byte accounting. Before removal, the local wrapper remains; after
  removal, the persisted `Evicting` checkpoint is sufficient to finish without misclassifying the
  intentional absence.
- Packaged Worker evidence: the journey
  `resumes every packaged storage-relief removal boundary and preserves partial cancellation`
  terminates the real extension Worker after `Verified`, after `Evicting`, after OPFS removal, and
  after the atomic `RemoteOnly` commit. Each restart resumes the same Job, converges to exactly one
  availability row per heavy wrapper, and restores both wrappers before exercising the next
  boundary. A final run cancels after one durable eviction; the completed wrapper remains
  remote-only, the untouched wrapper remains a candidate, and another Worker restart retains the
  same terminal `Cancelled` Job without resuming it.
- Creation-boundary tests prove both `after-job-created` and `after-candidate-checkpoint` can be
  reached only after the single atomic Job/checkpoint transaction completed. Lock and
  authentication tests retain the `Candidate` wrapper in their named waiting state and resume the
  same Job after unlock/login; a changed active Vault fails with `VAULT_CONTEXT_CHANGED` before
  synchronization or deletion.
- Release exclusion: the production build passes an extended verifier that rejects any emitted
  `storage-relief:`, `artifact-retrieval:`, or `stale-discard:` fault checkpoint prefix. The tested
  production bundle contains none of those E2E-only controls.

## Library, Complete Export, and live retrieval

- The Library exposes **Storage maintenance** only in the applicable synchronized Account state,
  displays the exact local candidate count and encrypted byte total, requires an explicit warning,
  and projects running, progress, cancellation, skipped, failure, and terminal accounting from the
  persisted Job. The same Job state is live on simultaneous desktop and narrow Library surfaces.
- The packaged-Chrome journey
  `frees synchronized browser storage and restores remote Artifacts on demand` captures a real MHTML
  primary and full-page screenshot, pauses the foreground synchronization boundary, confirms both
  open surfaces render progress, completes verified eviction, and directly observes the exact
  `RemoteOnly` count. An ordinary synchronization run preserves that intentional absence.
- The same journey performs Complete Export while both heavy wrappers are remote-only. The Export
  retrieves and verifies both canonical server wrappers, validates the Complete package, and reaches
  the native `Download` stage without rehydrating either wrapper. The service Worker downloads the
  validated package through Chrome's Downloads API, a fresh packaged extension imports it as a
  local-only Vault, and exact PRIMARY bytes match the original capture. The imported Vault contains
  no `RemoteOnly` rows; the source Vault's remote-only count remains unchanged.
- RED: the Chrome Download Host began the native download before subscribing to completion events,
  so a fast terminal transition could be missed indefinitely, and download interruptions were not
  consistently mapped to the Runtime Export error contract.
- GREEN: the Host now subscribes first, reconciles the current download record, removes its exact
  listener on every terminal path, and maps missing, interrupted, and failed downloads to
  `EXPORT_DOWNLOAD_FAILED`. The packaged imported-Vault journey injects that failure immediately
  before the native call, observes a failed Download-stage Job, retries, and downloads a nonempty
  package successfully.
- Storage-maintenance progress uses one polite atomic status region. Packaged desktop and narrow
  surfaces prove keyboard activation of Cancel, cancellation announcement and focus restoration to
  the enabled action, plus success announcement and focus transfer to the maintenance heading.
- Offline detail renders `Stored on server · retrieves when opened` and a reconnect instruction.
  After reconnection, opening the detail retrieves, authenticates, decrypts, and displays the real
  full-page screenshot; exactly that Artifact's current availability row clears, the historical
  storage-relief Job remains readable, and the other surface reconciles without reload.
- Sign-out presents the exact number of remaining remote-only Artifacts and warns that access depends
  on signing into the same Account and server again. Cancelling the native warning leaves the Account
  authenticated.

## Vacuum, server switching, and stale Replica discard

- IndexedDB Vacuum integration proves one atomic commit removes reclaimed Objects, matching
  `RemoteOnly` rows, terminal relief checkpoints, and terminal relief Job history.
- Server Switch publish tests prove an Artifact reader can relay exact encrypted bytes from the
  source server to the candidate when OPFS has no wrapper. Promotion fault injection includes
  availability and relief stores at every transaction write: failure retains the source state and
  success atomically clears obsolete availability with the promoted local Replica.
- The packaged first-use journey now evicts every heavy wrapper on the source server before changing
  to an empty second server. Direct OPFS inspection proves absence before the switch. Candidate
  publication relays and verifies those wrappers from the source, candidate verification reads
  remote-only wrappers transiently from the candidate itself, promotion preserves the same
  availability rows, and subsequent screenshot/PRIMARY access succeeds only through the promoted
  server before clearing those rows.
- RED: an exception during remote-only Artifact relay after candidate authentication could leave an
  uncommitted Server Switch Job `Running`, even though the initiating request had already failed.
- GREEN: every pre-promotion Compare, candidate-prepare, and local-prepare failure now erases
  candidate credentials and Vault context, clears restart checkpoints, and records one terminal
  Failed Job with the exact Runtime error. A packaged journey independently proves source
  authentication expiry, candidate upload interruption, and corrupted source ciphertext while the
  source server remains authoritative, all availability rows remain `RemoteOnly`, and the Library
  remains readable.
- The stale-Replica workflow now performs export-first explicit discard. The removed recovery-fork
  Command, error, stage, result, implementation, and tests have no compatibility aliases. The
  replacement downloader journals each Artifact before its OPFS write, verifies the complete remote
  Replica, and atomically installs it without creating another Vault.
- Restart integration interrupts every stale-discard stage and proves deterministic reconciliation.
  The packaged stale-Replica journey downloads a real Complete Export from the exact Recovery
  Snapshot before the first discard attempt, then interrupts every discard checkpoint. Later
  attempts exercise the two-part skip confirmation. Desktop and narrow screenshots cover conflict,
  successful Recovery Export, and replacement states.

## Docker remote-only round trip

- `corepack pnpm test:sync-proof` now models a client-held encrypted Artifact wrapper and its
  plaintext independently from the zero-knowledge server. The proof verifies exact active-Generation
  Artifact metadata and the owning Event dependency closure before deleting the simulated local
  wrapper and recording remote-only availability. It then downloads the wrapper in bounded ranges,
  matches the exact ciphertext digest, decrypts the original plaintext client-side, restores the
  local copy, and clears remote-only availability. Two Replicas still converge through HTTP, Cable,
  polling, Generation recovery, and verified purge.

## Defects found and locked by the real journey

- RED: the production-shaped Artifact resolver fixture failed four paths because the decoder accepted
  only `{ url }`, while the Coordination Server returns the canonical GET TransferTicket with
  `method`, `url`, `expiresAt`, and `requiredHeaders`.
- GREEN: the decoder now validates the canonical response, and both ciphertext and plaintext resolver
  suites pass. The packaged Complete Export progresses through package validation.
- RED: malformed same-length server bytes reached RestoreLocal preparation as an untyped storage
  failure, so Library converted the result to `BUNDLE_INVALID` instead of a remote integrity error.
- GREEN: RestoreLocal now verifies the remote wrapper stream before OPFS preparation. Unit coverage
  and the packaged journey prove `REMOTE_ARTIFACT_INTEGRITY_FAILED`, removal of the partial local
  file, retention of `RemoteOnly`, no image success, and distinct visible integrity copy.
- RED: generated Export filenames retained fractional seconds and the offscreen document attempted
  to call the unavailable Downloads API, causing packaged Complete Export to fail before download.
- GREEN: the Runtime emits canonical `awsm-vault-YYYY-MM-DD.awsm` names, the offscreen document only
  owns Blob URL preparation, and the service Worker owns the Chrome download lifecycle. Current and
  Recovery Snapshot packaged Exports both download successfully.
- RED: a cancellation persisted while the runner was paused after `RemoteOnly` commit carried a
  later `updatedAt` than the runner's start time. Terminalization attempted to write the older start
  timestamp, violated the forward-only Job contract, and left the packaged Job indefinitely
  `Running` with `cancellationRequested: true`.
- GREEN: terminal and failure writes retain the latest persisted timestamp. The focused runner
  regression and packaged Worker journey both finish as `Cancelled`, preserve the completed
  eviction, and remain terminal after restart.
- RED: post-upload Server Switch verification reused immutable local Artifact Object records but
  then opened every payload directly from OPFS. A valid remote-only source relay therefore uploaded
  the candidate bytes and still failed promotion with `SYNCHRONIZATION_INTEGRITY_FAILED`.
- GREEN: unchanged-local candidate verification now uses the existing transient Artifact resolver
  hook. Local wrappers still verify locally; remote-only wrappers verify against the candidate
  server without rehydration or source fallback. The packaged empty-candidate switch preserves
  remote-only rows and restores successfully after promotion.
- RED: `FastForwardLocal` candidate comparison and predecessor proof reused immutable local
  Artifact Object records as evidence that their wrappers existed in OPFS. A stale browser with
  intentionally removed wrappers therefore failed semantic verification before classification,
  even though both candidate active and Recovery Snapshot scopes held exact encrypted copies.
- GREEN: candidate comparison now reads and verifies every candidate Artifact through the candidate
  server, Recovery Snapshot proof downloads and verifies its own complete Artifact closure, and
  `FastForwardLocal` prepares every successor Artifact through the candidate installation path. The
  packaged journey starts with absent OPFS wrappers and `RemoteOnly` rows, interrupts immediately
  before local activation, resumes after Worker restart, installs every authoritative wrapper, and
  clears all stale availability rows.
- RED: after successful wrapper restoration, an IndexedDB scenario failed to read the historical Job
  with `STORAGE_TRANSACTION_FAILED` because `latestStorageReliefJob()` required every historical
  `Evicted` checkpoint to retain a current `RemoteOnly` row.
- GREEN: historical Job outcome and current operational availability are independent. The post-clear
  integration read succeeds, and packaged retrieval renders the screenshot and updates both surfaces.
- A pre-existing server-switch E2E ordering race was made explicit: after a new source Capture, the
  observer could be queried while the source still reported the prior synchronized head. The journey
  now waits for the source synchronization before waiting for the observer.
- A packaged-capture race was reproduced from its retained Playwright trace: the popup reported
  `Downloading` immediately before a live invalidation replaced the Archive button during the mouse
  gesture, so no `CaptureActivePage` request or Job existed. Both shared packaged-capture helpers now
  wait for the synchronized Vault to reach `UpToDate` before exercising the button. The complete
  packaged suite then passed all 22 journeys in one run.
- RED: the initial relay-failure fixture filtered availability rows by a nonexistent `state` field,
  then reused candidate remote state across failure modes. It either saw no rows or allowed an
  earlier partial candidate generation to pre-empt the intended later fault.
- GREEN: the fixture reads the canonical availability-row shape and gives each failure mode an
  independent source Vault and candidate Account. The exact packaged journey passes all three
  terminal failure cases in one run.

## Final verification evidence

- `corepack pnpm --filter @awsm/browser-extension lint`: 239 files checked with no errors.
- `corepack pnpm --filter @awsm/browser-extension typecheck`: exits successfully.
- `corepack pnpm --filter @awsm/browser-extension test`: 73 files and 366 tests pass.
- `corepack pnpm --filter @awsm/browser-extension test:integration`: 45 real Chromium
  IndexedDB/OPFS tests pass.
- `corepack pnpm --filter @awsm/browser-extension build`: production build and release security
  verifier pass.
- `corepack pnpm --filter @awsm/browser-extension test:e2e:chrome`: 24 packaged-Chromium journeys
  pass in one 6.0-minute run.
- `corepack pnpm test:sync-proof`: two Replicas converge through HTTP, Cable, polling, Generation
  recovery, and verified purge.
- `docker compose exec -T coordination-server env RAILS_ENV=test bundle exec rspec`: 46 examples,
  zero failures.
- Prettier passes for every changed Markdown document, including
  `docs/architecture/AGENTS.md` and `docs/specifications/runtime/AGENTS.md`.
- Production output contains no storage-relief, Artifact-retrieval, stale-discard,
  server-switch-relay, export-download, or generic test fault-control namespace.
- Fresh screenshots were visually inspected for estimate, running, success, offline remote-only,
  restored detail, and stale-discard states at desktop and narrow widths. Controls remain visible,
  readable, focusable, and free of clipping or unintended layout movement.
