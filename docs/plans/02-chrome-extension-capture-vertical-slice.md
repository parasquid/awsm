# Chrome Extension Capture Vertical Slice

**Document:** `docs/plans/02-chrome-extension-capture-vertical-slice.md`

**Status:** Implemented

**Owner:** Engineering

**Last Updated:** 2026-07-16

**Supersedes conflicting implementation guidance in:** existing Draft architecture and specification documents

**Implementation evidence:** `docs/plans/02-chrome-extension-capture-vertical-slice-tdd-evidence.md`

---

# 1. Purpose

This is the decision-complete implementation plan for the first AWSM executable software.

The implementer is expected to begin with a documentation-only checkout and no prior session context. Do not reopen decisions recorded here. If an older document conflicts with this plan, this plan wins and the older document must be reconciled.

The deliverable is a Chrome-only Manifest V3 extension that:

1. creates and unlocks a local Vault;
2. captures the active HTTP(S) page as mandatory MHTML;
3. attempts a full-page PNG screenshot and records a warning if it cannot;
4. constructs a deterministic, immutable Bundle;
5. encrypts all sensitive persisted data locally;
6. atomically registers the Bundle through a `BundleRegistered` Event;
7. lists and opens the capture while offline; and
8. lets the user download, but never execute, the archived MHTML.

This slice proves the preservation, privacy, immutability, Event, Projection, and offline boundaries before any backend work begins.

---

# 2. Mandatory TDD Execution Protocol

Test-driven development is a delivery constraint, not a preference.

For every behavior in this plan, use this loop:

1. **RED:** add the smallest test that describes the next observable behavior.
2. Run that test and confirm it fails for the expected missing-behavior reason.
3. **GREEN:** write the minimum production code needed to make it pass.
4. Run the focused test until it passes.
5. **REFACTOR:** improve names or structure without adding behavior.
6. Run the focused test again, then the complete affected test suite.

Rules:

- Do not write production behavior before its failing test.
- Do not weaken, delete, skip, or rewrite a failing test merely to obtain green.
- Do not use snapshots for cryptographic bytes, canonical serialization, or core domain behavior when explicit assertions are possible.
- Test through public interfaces. Use fakes only at Host and Driver boundaries.
- Every bug found during implementation first receives a failing regression test.
- Keep each RED-GREEN-REFACTOR cycle small enough to diagnose from one failure.
- A task is incomplete until its specified tests pass.
- The final milestone is incomplete until the extension has been exercised through real Chrome.

Record RED and GREEN command output in the implementation log or pull-request notes. A cold implementer must be able to demonstrate that tests failed before the corresponding behavior existed.

---

# 3. Scope and Fixed Decisions

## 3.1 Repository layout

Add only this implementation directory:

```text
apps/
└── browser-extension/
```

At repository root add only files needed to operate the workspace, such as:

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- shared ignore or formatter configuration when actually used

Do not create empty `backend/`, `packages/`, Firefox, shared-runtime, or placeholder directories.

Keep the Runtime/Host/Driver boundaries inside `apps/browser-extension` for this slice. Extracting a shared package before a second consumer exists is prohibited.

## 3.2 Platform and toolchain

- Package manager: pnpm workspace.
- Extension framework: WXT.
- Language: strict TypeScript.
- UI: vanilla HTML and CSS; no React or component framework.
- Browser: Chrome only.
- Manifest: MV3.
- Minimum Chrome version: 116.
- Unit/integration runner: Vitest.
- browser E2E runner: Playwright.
- Formatting/linting: Biome.

Enable at least:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `useUnknownInCatchVariables`
- `noImplicitOverride`

Do not use `any`, type-suppression directives, unchecked type assertions at storage boundaries, or non-null assertions. Decode unknown persisted values into `unknown`, validate them, and only then create domain types.

## 3.3 Dependencies

Runtime dependencies:

- `libsodium-wrappers-sumo`: XChaCha20-Poly1305 and Argon2id.
- `fflate`: ZIP creation and reading.
- `cborg`: canonical CBOR.

Development dependencies:

- `wxt`
- `typescript`
- `vitest`
- `@playwright/test`
- `@biomejs/biome`
- sodium TypeScript declarations if the installed wrapper version does not provide them

Do not add:

- a state-management library;
- a database wrapper;
- a ZIP abstraction beyond `fflate`;
- an ID library;
- a UI framework;
- a logging framework; or
- a cryptographic library other than Web Crypto plus libsodium.

Use `crypto.randomUUID()` for v1 opaque identifiers.

## 3.4 Chrome permissions

The manifest requests only:

- `activeTab`
- `scripting`
- `pageCapture`
- `offscreen`
- `unlimitedStorage`

Do not request:

- broad host permissions;
- `debugger`;
- `downloads`;
- cookies;
- history; or
- network access.

The toolbar action supplies the temporary `activeTab` grant.

## 3.5 Explicitly deferred

The slice excludes Rails, coordination services, synchronization, accounts, billing, Firefox, AI, search, tags, folders, notes, sharing, Backup, Restore, Import, Export, scheduled capture, PDF, sanitized HTML rendering, Chrome Web Store publication, passphrase recovery/change, and post-onboarding key-slot management.

---

# 4. Required Internal Structure

Use this responsibility layout; individual filenames may be split further to keep modules focused:

```text
apps/browser-extension/
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   ├── popup/
│   ├── onboarding/
│   ├── library/
│   └── offscreen/
├── src/
│   ├── domain/
│   ├── runtime/
│   ├── crypto/
│   ├── hosts/chrome/
│   ├── drivers/indexeddb/
│   └── ui/
└── tests/
    ├── unit/
    ├── integration/
    ├── e2e/
    └── fixtures/
```

Boundaries:

- **Chrome Host:** tabs, permissions, MHTML, screenshots, scrolling, offscreen documents, downloads initiated by an extension page, and lifecycle signals.
- **Runtime:** validation, capture orchestration, Bundle creation, Commands, Events, Projection reducers, and transaction intent.
- **Crypto:** key slots, derivation, envelopes, authenticated encryption, hashing, and byte cleanup.
- **IndexedDB Driver:** persistence primitives and transaction mechanics only; it does not decide domain behavior.
- **UI:** sends Commands or queries Runtime read interfaces; it never writes authoritative records directly.

No Chrome API may appear in `domain/`, `runtime/`, or `crypto/`. No IndexedDB API may appear outside the Driver.

---

# 5. Public Runtime Interfaces

Implement versioned discriminated unions rather than untyped messages.

## 5.1 Commands

`CapturePageCommandV1` contains:

- command ID;
- literal command type `CapturePage`;
- command version `1`;
- issuing Device ID;
- creation timestamp;
- tab ID;
- observed URL;
- capture profile ID `ChromeWebPage-v1`; and
- idempotency key equal to the command ID.

`CreateVaultCommandV1` contains:

- command ID;
- literal command type `CreateVault`;
- command version `1`;
- creation timestamp; and
- optional passphrase supplied only in memory.

`UnlockVaultCommandV1` selects either the device slot or passphrase slot. Passphrases never enter logs, persisted jobs, Runtime Events, or error details.

## 5.2 Capture result

`CaptureResultV1` contains:

- original URL;
- final URL;
- title;
- capture timestamp;
- content type when known;
- viewport dimensions;
- document dimensions;
- Chrome version;
- extension version;
- Capture Profile ID and version;
- mandatory MHTML bytes;
- optional PNG bytes; and
- zero or more typed warnings.

Initial warning identifiers:

- `SCREENSHOT_UNAVAILABLE`
- `SCREENSHOT_TOO_LARGE`
- `SCREENSHOT_CAPTURE_FAILED`
- `OPTIONAL_METADATA_UNAVAILABLE`

Warnings are stable machine-readable identifiers with non-sensitive display text. Diagnostics must not contain URLs, titles, page content, keys, passphrases, MHTML, or screenshots.

## 5.3 Event

The successful command produces exactly one `BundleRegisteredV1` Event with:

- Event ID;
- Event type `BundleRegistered`;
- Event and payload version `1`;
- Vault ID;
- Device ID;
- canonical UTC timestamp;
- protocol version;
- correlation ID equal to the capture command ID;
- Bundle ID;
- Bundle Object ID;
- capture profile ID;
- encrypted user-visible capture metadata; and
- integrity metadata.

`BundleRegistered`, not `BundleCreated`, is canonical because the Event records acceptance into Vault history rather than completion of a Host capture operation.

## 5.4 Read model

`LibraryItemV1` is a rebuildable Projection row containing:

- Bundle ID;
- Bundle Object ID;
- title;
- original URL;
- capture timestamp;
- screenshot-present flag; and
- capture warning identifiers.

Persist each row encrypted. The Projection is never authoritative and can be rebuilt by replaying `BundleRegistered` Events.

## 5.5 Error model

Use typed errors with stable identifiers:

- `VAULT_LOCKED`
- `UNSUPPORTED_URL`
- `PERMISSION_DENIED`
- `MHTML_UNAVAILABLE`
- `MHTML_CAPTURE_FAILED`
- `CAPTURE_TOO_LARGE`
- `CAPTURE_INTERRUPTED`
- `BUNDLE_INVALID`
- `CRYPTO_AUTHENTICATION_FAILED`
- `UNSUPPORTED_FORMAT_VERSION`
- `STORAGE_TRANSACTION_FAILED`
- `WRONG_PASSPHRASE`

UI behavior branches on identifiers, never on message text.

---

# 6. Vault and Cryptography Contract

## 6.1 Vault creation

On first run:

1. Generate a Vault ID and Device ID with `crypto.randomUUID()`.
2. Generate 32 random bytes for the Vault Root Key using the Host CSPRNG.
3. Create the mandatory device key slot.
4. If the user supplied a passphrase, create the optional passphrase slot.
5. Atomically store Vault metadata and all created slots.
6. Import the Vault Root Key into the in-memory key handle required for derivation.
7. Best-effort overwrite temporary raw key byte arrays.

The Vault Root Key is never stored unwrapped.

## 6.2 Device slot

- Generate a non-exportable 256-bit AES-KW `CryptoKey` with Web Crypto.
- Persist the non-exportable `CryptoKey` through IndexedDB structured cloning.
- Import the Vault Root Key bytes temporarily as an extractable 256-bit HMAC `CryptoKey` carrier because Web Crypto forbids extractable HKDF keys. Wrap that carrier with AES-KW. On device unlock, unwrap/export the carrier only long enough to import the same bytes as a non-exportable HKDF `CryptoKey`, then best-effort wipe the exported byte array.
- Store Vault ID, Device ID, slot ID, algorithm identifier, and slot version with the slot.
- Use algorithm identifier `wrap:aes-kw-256:device:v1`.

AES-KW has no AAD input. After every device-slot unwrap, derive a `vault:verifier:v1` key and authenticate a fixed Vault verifier whose AAD contains the canonical Vault ID, Device ID, slot ID, algorithm identifier, and slot version. Do not expose the Vault as unlocked until verifier authentication succeeds.

Normal service-worker activation may automatically unlock the Vault through the device slot. A user-requested manual lock persists an operational lock flag; while set, automatic unlock is forbidden until the user explicitly selects device or passphrase unlock.

## 6.3 Passphrase slot

- Optional during onboarding.
- Require at least 12 Unicode code points and at most 1,024 UTF-8 bytes.
- Do not impose composition rules.
- Generate a random 16-byte salt.
- Derive a 32-byte key with Argon2id using 64 MiB memory and three iterations.
- Store the numeric Argon2 parameters with the slot.
- Wrap the Vault Root Key with XChaCha20-Poly1305 and a random 24-byte nonce.
- Authenticate slot version, Vault ID, slot ID, KDF parameters, and algorithm identifiers as AAD.
- Use identifiers `kdf:argon2id:v1` and `wrap:xchacha20poly1305:passphrase:v1`.

Wrong passphrases and corrupted slots return the same public error so the UI does not reveal which validation failed.

## 6.4 Derived keys

Do not generate or persist random per-Bundle keys in v1.

Derive 32-byte context keys with HKDF-SHA256 from the Vault Root Key:

- Bundle Object: domain `vault:bundle:v1`, context Vault ID + Bundle ID.
- Event Object: domain `vault:event:v1`, context Vault ID + Event ID.
- Projection row: domain `vault:projection:v1`, context Vault ID + projection type + Bundle ID.

The HKDF salt, domain, parent-key version, output-key version, and context encoding must be explicit and covered by golden-vector tests. Concatenate fields only through a length-delimited canonical encoding; never use ambiguous string concatenation.

## 6.5 Encrypted envelope

Every encrypted record uses:

- format version;
- Object type;
- encryption algorithm identifier `enc:xchacha20poly1305:v1`;
- Object identifier;
- optional payload length;
- random 24-byte nonce;
- ciphertext plus authentication tag.

Encode the plaintext header canonically and pass its exact bytes as AAD. The header contains no user content. Authentication must succeed before any plaintext is returned.

Use libsodium only after its readiness promise resolves during each extension execution context activation. Best-effort clear temporary plaintext and key byte arrays after use; do not claim JavaScript provides guaranteed memory erasure.

---

# 7. Bundle Format

## 7.1 First Capture Profile

The first and only profile is `ChromeWebPage-v1`.

Required:

- active HTTP(S) tab;
- Chrome MHTML capture capability;
- one MHTML Artifact with Kind `CAPTURE`, Role `PRIMARY`, and MIME type `multipart/related`; and
- required capture metadata.

Best effort:

- full-page PNG Artifact with Kind `IMAGE`, Role `SCREENSHOT_FULL`, and MIME type `image/png`.

The profile succeeds when MHTML and required metadata are valid. Screenshot failure produces a typed warning and no screenshot Artifact. It does not invalidate the Bundle.

## 7.2 ZIP layout

The canonical plaintext Bundle representation is a ZIP archive:

```text
manifest.cbor
metadata.cbor
artifacts/
├── primary.mhtml
└── screenshot-full.png   # omitted when unavailable
```

Rules:

- UTF-8 paths exactly as shown.
- Entries sorted lexicographically by complete path.
- No directory entries.
- Fixed ZIP timestamp of 1980-01-01 00:00:00.
- Fixed compression level selected once in code and named in the serialization version.
- No platform-specific extra fields, comments, or nondeterministic attributes.
- ZIP serialization identifier `bundle:zip:v1`.
- Canonical CBOR identifier `cbor:canonical:v1`.
- Same logical inputs and versions must produce byte-identical ZIP output.

## 7.3 Manifest and metadata

`manifest.cbor` is canonical CBOR and contains:

- Manifest version;
- Bundle specification version;
- serialization identifiers;
- Bundle ID;
- creation timestamp;
- creating client version;
- Capture Profile ID;
- Capture Adapter version;
- ordered Artifact references; and
- required validation metadata.

Each Artifact reference contains:

- Artifact ID;
- Artifact schema version;
- Kind;
- Role;
- MIME type;
- byte length;
- SHA-256 checksum bytes;
- checksum algorithm identifier `hash:sha256:v1`; and
- canonical path.

`metadata.cbor` contains the user-sensitive capture metadata from `CaptureResultV1`. It is inside the encrypted Bundle and must not be copied into plaintext storage records.

Artifact identifiers are assigned deterministically within the Bundle:

- `A000001`: primary MHTML.
- `A000002`: full screenshot when present.

Readers locate Artifacts by Role and ID, not filename or order.

## 7.4 Limits and validation

- Maximum complete plaintext ZIP size: 100 MiB.
- Abort before authoritative persistence if the limit is exceeded.
- Verify required fields, unique Artifact IDs, unique Roles required by the profile, lengths, SHA-256 checksums, paths, versions, and MHTML non-emptiness.
- Validate the complete Bundle before encryption.
- Validate envelope authentication and Artifact checksums before offline use.
- Unknown optional Manifest fields are accepted and preserved by any future reserialization; unknown mandatory versions are rejected.

---

# 8. Capture Pipeline

Execute capture as a persisted Runtime Job, but treat live page acquisition as non-resumable.

## 8.1 Preflight

Before collecting page bytes:

1. confirm the Vault is unlocked;
2. resolve the current active tab from the user action;
3. validate that its URL uses `http:` or `https:`;
4. verify required permissions and Chrome APIs;
5. verify `ChromeWebPage-v1` support;
6. create a persisted capture job; and
7. reject before Bundle construction if mandatory capability is unavailable.

Restricted URLs, browser pages, extension pages, view-source pages, and missing tab IDs fail with `UNSUPPORTED_URL`.

## 8.2 Mandatory MHTML

Call `chrome.pageCapture.saveAsMHTML({ tabId })`.

- An unavailable API, rejection, empty Blob, or unreadable Blob is a terminal capture failure.
- MHTML failure produces no Bundle, Event, or Projection row.
- Convert the Blob to bytes only inside the trusted extension context.

## 8.3 Best-effort screenshot

The content script:

1. records the original scroll position and mutable style changes;
2. measures viewport and document dimensions;
3. computes tiles with bounded dimensions;
4. scrolls to each tile position;
5. waits for layout/paint stabilization;
6. hides repeated fixed/sticky elements after the first tile where possible; and
7. restores scroll position and all temporary styles in `finally`.

The background Host calls `chrome.tabs.captureVisibleTab` no faster than two calls per second. Use a minimum 600 ms interval between calls.

The offscreen document stitches decoded tile images into one PNG. Create it with the narrowest applicable offscreen reason and a literal justification. Close it when no capture or image work remains.

If dimensions exceed safe canvas/browser limits, a tile fails, the tab changes, or stitching fails:

- discard all partial screenshot bytes;
- restore the page;
- add one typed screenshot warning; and
- continue with mandatory MHTML.

## 8.4 Interruption

Persist only operational job stage, progress, non-sensitive error identifier, command ID, tab ID, and timestamps. Never persist captured plaintext in the job.

If the MV3 worker stops during live acquisition:

- detect the stale `Running` job at next activation;
- mark it `Failed` with `CAPTURE_INTERRUPTED`;
- do not automatically resume or recapture the page;
- show a manual Retry action that creates a new command/job; and
- use the original command ID/idempotency record to detect whether authoritative commit had already succeeded.

No interrupted job may leave a partial Bundle Object or Event.

---

# 9. IndexedDB Storage

Use one IndexedDB database named `awsm-vault`. IndexedDB's internal schema version owns storage versioning; feature names and schema versions do not belong in the database name. This is the sole canonical pre-release database, and earlier development databases are intentionally abandoned rather than migrated. Encapsulate all access in the IndexedDB Driver.

Required stores:

- `vault_metadata`: Vault identity, versions, manual-lock flag, and non-sensitive operational state.
- `key_slots`: device and passphrase slot metadata plus wrapped key bytes.
- `device_keys`: non-exportable Web Crypto device wrapping keys.
- `objects`: immutable encrypted authoritative Objects keyed by Object ID.
- `events`: encrypted Event Objects keyed by Event ID with only required non-sensitive ordering fields outside ciphertext.
- `library_projection`: encrypted rebuildable rows keyed by Bundle ID.
- `capture_jobs`: operational job state.
- `command_outcomes`: idempotency mapping from command ID to terminal outcome and resulting IDs.

All schema values carry explicit version fields.

`vault_metadata` also stores the encrypted Vault verifier required to authenticate device-slot metadata after AES-KW unwrap.

Storage behavior:

- `PutObject` rejects replacement of an existing Object ID unless the bytes are identical.
- `GetObject` verifies stored checksum and AEAD before returning plaintext upward.
- Encryption, Bundle validation, and Event creation happen before opening the commit transaction.
- One IndexedDB read-write transaction writes the Bundle Object, Event, Projection row, and command outcome.
- Transaction abort leaves all four absent.
- Job state is operational and updated separately after authoritative commit.
- If authoritative commit succeeded but the worker stopped before job completion was recorded, startup reconciliation uses `command_outcomes` to mark the job succeeded without duplicating the Event.
- `chrome.storage`, `localStorage`, Cache Storage, and plaintext files are prohibited.

Request persistent/unlimited extension storage, but still report quota failures as typed storage errors.

---

# 10. User Interface

Create `DESIGN.md` in the extension app before styling UI. Define a compact archival visual language, local system-font stack, colors, spacing, focus treatment, and reduced-motion behavior.

No remote fonts, images, scripts, styles, telemetry, or analytics.

## 10.1 Onboarding/unlock

Onboarding:

- explains local-only storage in plain language;
- creates the mandatory device slot;
- offers but does not require a passphrase;
- confirms the passphrase before creation; and
- never persists form values.

Unlock:

- offers one-click device unlock;
- shows passphrase unlock only when a passphrase slot exists;
- presents the same failure message for wrong passphrase and corrupt passphrase slot; and
- clears form values after submission.

## 10.2 Popup

Required states:

- locked;
- unsupported page;
- ready;
- capturing with current stage;
- success;
- success with screenshot warning; and
- failure with retry where safe.

Closing the popup must not cancel an active background capture. Reopening it reads job state.

## 10.3 Library

Required states:

- locked;
- empty;
- list;
- detail;
- corrupted capture error.

After unlock, decrypt Projection rows for the list. The detail view decrypts and validates the Bundle, displays metadata and the PNG when present, and offers an MHTML download.

MHTML handling:

- never embed it in an iframe, object, webview, or extension page;
- never navigate the browser to a generated MHTML URL;
- create a Blob URL only in response to a user download action;
- trigger a local anchor download without requesting `downloads`; and
- revoke the Blob URL after use.

The library must remain usable with networking disabled.

## 10.4 Accessibility

- semantic HTML controls;
- full keyboard operation;
- visible focus;
- programmatic labels;
- status announcements that do not repeatedly interrupt assistive technology;
- sufficient contrast;
- reduced-motion support; and
- no information conveyed by color alone.

---

# 11. Implementation Tasks

Complete tasks in order. Each behavior task follows the mandatory RED-GREEN-REFACTOR protocol.

## Task 1: Workspace and executable extension shell

RED:

- Add a smoke test that imports the Runtime version descriptor and fails because it does not exist.

GREEN:

- Add root pnpm workspace files.
- Scaffold `apps/browser-extension` with WXT and strict TypeScript.
- Add scripts: `dev`, `build`, `zip`, `typecheck`, `lint`, `test`, `test:watch`, `test:e2e`, and `test:e2e:chrome`.
- Add minimal popup/background entrypoints and the Runtime version descriptor.
- Configure the exact permissions and Chrome 116 minimum.

Verify:

- focused smoke test;
- `pnpm typecheck`;
- `pnpm build`.

## Task 2: Domain schemas and boundary decoders

RED:

- Tests reject missing versions, unknown mandatory versions, invalid URLs, malformed identifiers, duplicate Artifact IDs, and unknown error shapes.
- Tests accept and preserve unknown optional fields where required.

GREEN:

- Implement Commands, Events, Capture Result, Manifest, Artifact, envelope, Projection, job, and error types.
- Implement explicit decoders from `unknown`.

Verify:

- all schema tests;
- typecheck and lint.

## Task 3: Canonical CBOR, hashing, and deterministic ZIP

RED:

- Golden tests prove equivalent Maps serialize to identical canonical CBOR.
- Golden tests prove ZIP output is byte-identical across repeated runs.
- Tests detect changed Artifact bytes, path order, timestamps, lengths, and checksums.

GREEN:

- Implement canonical encoders/decoders.
- Implement SHA-256 helpers.
- Implement Bundle builder, validator, ZIP writer, and ZIP reader.

Verify:

- golden byte tests;
- round-trip tests;
- malformed archive tests.

## Task 4: Cryptographic envelope and derived keys

RED:

- Use fixed official or independently generated vectors for HKDF-SHA256, XChaCha20-Poly1305, and Argon2id.
- Tests fail on nonce, header, ciphertext, tag, Object ID, or algorithm mutation.
- Tests prove domain/context changes produce different keys.

GREEN:

- Implement sodium readiness.
- Implement length-delimited derivation context.
- Implement key derivation, envelopes, encryption/decryption, and typed failures.

Verify:

- vector and mutation suites;
- confirm no plaintext appears in encoded envelopes.

## Task 5: Vault creation, device slot, and optional passphrase slot

RED:

- Tests cover create/unlock/lock, automatic activation unlock, persistent manual lock, wrong passphrase, corrupt slot, tampered device-slot metadata, Vault verifier failure, slot version rejection, and atomic onboarding failure.

GREEN:

- Implement Vault lifecycle and both key slots.
- Keep passphrases and unwrapped keys memory-only.
- Implement best-effort byte clearing.

Verify:

- unit tests with fake key repository;
- IndexedDB integration test proving the device key remains non-exportable.

## Task 6: IndexedDB Driver and atomic registration

RED:

- Tests cover immutable Object insertion, identical duplicate acceptance, conflicting duplicate rejection, aborted transactions, Projection rebuild, quota errors, and command idempotency.
- A forced failure on each transaction write proves no authoritative subset persists.

GREEN:

- Implement the single canonical version-1 schema, repositories, transaction boundary, and startup reconciliation. Before the first declared release, replace superseded schema drafts directly instead of adding migrations or compatibility paths.

Verify:

- integration tests against real browser IndexedDB, not an in-memory imitation.

## Task 7: Preflight and mandatory MHTML Host

RED:

- Host-contract tests cover supported HTTP(S), restricted schemes, missing tab, missing API, denied permission, empty MHTML, and MHTML rejection.
- Runtime tests prove every mandatory failure leaves no Bundle/Event/Projection.

GREEN:

- Implement popup command dispatch, preflight, job creation, and MHTML acquisition.

Verify:

- unit tests with a fake Chrome Host;
- Playwright fixture capture producing real MHTML.

## Task 8: Best-effort full-page screenshot

RED:

- Geometry tests cover one viewport, multiple tiles, fractional device pixel ratio, final partial tile, fixed/sticky mitigation, maximum dimensions, and restoration after every failure point.
- Runtime tests prove screenshot failures become warnings while MHTML continues.

GREEN:

- Implement scrolling, throttled capture, offscreen stitching, PNG creation, cleanup, and warnings.

Verify:

- deterministic fixture pages;
- pixel dimensions and basic landmark-color assertions;
- manual Chrome check on short and tall pages.

## Task 9: Complete capture, Bundle registration, and interruption recovery

RED:

- Integration tests cover successful atomic commit, screenshot warning commit, mandatory MHTML failure, 100 MiB limit, interruption before commit, interruption after commit, and repeated command IDs.
- Event replay tests prove duplicate Events do not duplicate library rows.

GREEN:

- Connect Capture Result to Bundle builder, encryption, `BundleRegistered`, Projection reducer, command outcome, and job completion.

Verify:

- full integration suite;
- terminate/restart the MV3 worker during acquisition and around commit.

## Task 10: Onboarding, popup, and offline library

RED:

- UI tests cover every declared state and keyboard path.
- E2E test captures a fixture, disables networking, reopens the library, views the screenshot/metadata, and downloads MHTML.
- Security test proves MHTML is never embedded or executed.

GREEN:

- Implement `DESIGN.md`, onboarding, unlock, popup states, list/detail library, Blob download, accessibility, and local styling.

Verify:

- Playwright in packaged bundled Chromium;
- headed Chrome Stable smoke;
- console contains no errors;
- visual inspection at popup width and common library viewport sizes.

## Task 11: Security and release gate

RED:

- Add a regression test for every issue found during the manual security/QA pass.

GREEN:

- Fix only demonstrated defects.

Verify all:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e:chrome
```

Manually inspect IndexedDB and built extension assets to confirm:

- no page URL, title, MHTML, screenshot, passphrase, unwrapped key, or decrypted Projection is persisted in plaintext;
- no remote code or assets exist;
- permissions match the allowlist;
- corrupt ciphertext is rejected before rendering; and
- forced interruption never creates a partial authoritative capture.

---

# 12. Acceptance Criteria

The slice is complete only when all are true:

1. A new user can create a Vault with only the device slot or with device plus passphrase slots.
2. The Vault Root Key is never stored unwrapped.
3. A user can capture a local HTTP fixture through the toolbar action.
4. Valid MHTML is mandatory.
5. Full-page PNG is attempted without `debugger`; failure is a visible warning, not data loss.
6. The resulting deterministic Bundle validates before encryption.
7. Sensitive Bundle, Event, and Projection data is encrypted at rest.
8. Registration atomically persists one Bundle Object, one `BundleRegistered` Event, one Projection row, and one command outcome.
9. Retrying the same command cannot duplicate authoritative state.
10. Terminating the worker cannot persist an incomplete Bundle.
11. With networking disabled, the user can list the capture, view its screenshot and metadata, and download its MHTML.
12. Archived MHTML is never executed by the extension.
13. Restricted pages fail before capture.
14. The built manifest contains only approved permissions.
15. All quality-gate commands pass.
16. Test history demonstrates RED before GREEN for each behavior task.

---

# 13. Documentation Authority for This Slice

This plan records the explicit decisions that resolve the first-slice questions in `docs/architecture/consistency-review.md`:

- Event name: `BundleRegistered`.
- Capture Profile: `ChromeWebPage-v1`.
- Browser scope: Chrome only.
- Bundle serialization: deterministic ZIP with canonical CBOR.
- Browser persistence Driver: IndexedDB for v1.
- Bundle/Event/Projection keys: HKDF-derived context keys.
- Vault Root Key storage: mandatory local device slot plus optional passphrase slot.
- Screenshot: best effort.
- MHTML: mandatory.
- Interrupted live capture: fail and require manual retry; never auto-recapture.

When implementing, do not restore older conflicting language. Any newly discovered conflict must be resolved in favor of this plan while preserving the normative privacy, immutability, versioning, and Runtime/Host/Driver boundaries.

---

# 14. Post-Implementation Polish

## 14.1 Identifiable and dismissible recent capture

**Added:** 2026-07-16

The original popup persisted a generic “Page archived in your Vault” message. On later popup openings, that message looked like a new action result and did not identify which page it described.

Replace the generic persisted success message with a recent-capture card that:

1. prefixes the decrypted page title with `Archived:`;
2. displays a small visual thumbnail of the full-page screenshot when that optional Artifact exists;
3. displays the typed screenshot warning in the same card when no screenshot exists;
4. provides an accessible close button whose label identifies the captured page;
5. treats closing the popup or choosing `Open library` as implicit dismissal because the preview has been seen;
6. persists explicit or implicit dismissal across later popup openings and MV3 worker restart;
7. does not show a dismissed card again; and
8. shows a new card after the next successful capture.

The preview card itself is an accessible control. Activating it marks the preview as seen and opens the immutable detail view for that exact Bundle in the Library; it must not route through the page collection or choose whichever capture is newest later.

The card is derived from the latest encrypted Projection and Bundle after Vault unlock. Title and screenshot content remain encrypted at rest. Only the opaque operational capture job stores the dismissal Boolean; it must not store title, URL, screenshot, or other decrypted capture content.

Failures remain retryable alerts rather than recent-capture cards. Active capture progress remains persistent when the popup closes.

### TDD and verification

- Popup state tests must fail before the recent-capture model exists and pass with title, thumbnail, and dismissibility.
- Capture-job boundary tests must fail before the additive dismissal flag is decoded.
- A real-browser IndexedDB test must prove dismissal persists on the completed operational job.
- Packaged-Chrome E2E must prove the title and thumbnail are shown, the close control is accessible, and the card remains absent after closing and reopening the popup.
- Opening the Library must persist the same seen state before navigation, so returning to the popup cannot resurrect the preview.

## 14.2 Group repeated captures as page history

**Added:** 2026-07-16

Repeated captures of the same page remain distinct immutable Bundles and `BundleRegistered` Events. The Library must not present those archival moments as unrelated duplicate cards.

The Library Projection groups visible captures by normalized page URL:

- parse the captured URL as an absolute HTTP(S) URL;
- remove only the fragment when producing the page key;
- retain path and query parameters, because they may identify different resources;
- sort captures within a group newest first; and
- use the newest capture for the group title, timestamp, warning state, and thumbnail.

One Library card represents one page key and displays the number of captures. Opening the card shows a newest-first capture history. Opening a history entry displays that immutable Bundle’s existing detail view and download action. Grouping changes only the rebuildable Library Projection and UI; it never merges, replaces, or deletes Bundles or Events.

Every collection exposes a distinct `Visit original site` link using the newest capture's original URL. It opens in a new tab with opener isolation and remains separate from the control that opens archived capture history. The collection-history view retains the same link.

Every immutable capture detail also exposes `Visit original site`, using that individual capture's recorded original URL. This link remains distinct from both the archived MHTML download and collection navigation.

Capture detail uses breadcrumb navigation rather than a generic back button: `Library / Collection / Capture`. `Library` returns to the collection list, the collection title returns to that collection's history, and the capture timestamp identifies the current page. For a one-capture collection, omit the collection crumb because the intentionally skipped history screen does not exist. Direct links from the popup resolve the owning collection before rendering the same breadcrumbs.

## 14.3 Library thumbnails and deletion

**Added:** 2026-07-16

Each grouped Library card displays the newest capture’s screenshot as a cropped visual thumbnail when the optional screenshot Artifact exists. During the same offscreen stitch operation, the Host derives a bounded 320×180 PNG from the full screenshot. The Runtime stores that PNG inside the encrypted Library Projection; it is a rebuildable Materialization, not an authoritative Bundle Artifact. No separate live-page capture, plaintext thumbnail file, Cache Storage entry, or remote asset is permitted.

The original pre-release “Remove from Library” model has been replaced directly. Section 15 is the sole canonical deletion, restoration, Deleted, Vault Generation, and Vault Vacuum design. There is no `LibraryGroupRemoved` Event or compatibility behavior.

### TDD and verification

- Unit tests must prove normalized-URL grouping and newest-first history.
- Section 15 owns deletion/restoration/Vacuum TDD and verification.

## 14.4 Collection visualization and capture thumbnails

**Added:** 2026-07-17

A grouped page with multiple captures must visually read as a collection before it is opened. Its Library card uses up to the three newest captures’ actual screenshot thumbnails as a deliberately imperfect stack:

- the newest thumbnail is the front card;
- older thumbnails peek from behind with small opposing offsets and rotations;
- layers are sourced from their respective captures' encrypted thumbnail Materializations, never duplicated from the newest screenshot; and
- the existing capture count remains visible in text, so the collection state is not conveyed by visuals alone.

Navigation depends on the collection size:

- **One capture:** clicking the Library card opens that capture’s detail directly. There is no redundant history step.
- **More than one capture:** clicking the stacked card opens the collection history. Every history entry displays its own screenshot thumbnail, title, and capture timestamp before linking to its immutable capture detail.

When a screenshot Artifact is absent, that capture remains accessible through its textual history entry and warning state; missing optional thumbnails must not hide a valid mandatory-MHTML capture.

The thumbnails are decrypted only after Vault unlock and remain presentation data. They are bounded to 320×180 before encrypted persistence so listing a collection never decrypts or transports every full-resolution screenshot. They are not new authoritative Artifacts, plaintext persistence, synchronized state, or substitutes for the original screenshot Artifacts.

This is the sole canonical pre-release representation. Existing development Vaults are recreated when this format changes; there is no thumbnail migration, legacy reader, lazy conversion, or compatibility fallback before the user declares the first release.

### TDD and verification

- A focused UI-model test must fail before single-item direct routing and multi-item collection routing exist.
- Unit tests must prove that collection layers select the actual newest capture IDs rather than repeating one capture.
- Packaged-Chrome E2E must create two visually different versions of the same fixture and prove the collection and history each contain two distinct screenshot sources.
- Packaged-Chrome E2E must assert that rendered Library thumbnails have natural dimensions no greater than 320×180.
- Persistence tests must prove thumbnail bytes exist in the decrypted Projection and do not appear in plaintext storage.
- Library failures must distinguish a locked Vault, an authenticated-record failure, and an unrelated request/transport failure rather than labeling every failure as authentication.

---

# 15. Deleted Captures, Vault Generations, and Vault Vacuum

**Added:** 2026-07-17

**Status:** Approved implementation plan. This section supersedes the removal semantics in section 14.3. `LibraryGroupRemoved`, `RemoveLibraryGroup`, removal without restoration, and the statement that permanent deletion is simply deferred are stale pre-release behavior. Replace them directly; do not preserve a compatibility reader or migration. Existing development Vaults may be discarded and recreated.

## 15.1 Goal and canonical terminology

AWSM must let a user delete either one capture or every current capture in a collection, inspect and restore deleted captures before reclamation, and explicitly reclaim their storage later without mutating any existing Object.

Use these names consistently:

- **Vault Generation:** an immutable authoritative reachability root belonging to one stable Vault ID.
- **Vault History Rewrite:** the internal process that constructs and verifies a successor Vault Generation while leaving the current generation untouched.
- **Vault Vacuum:** the explicit destructive Runtime Job that rewrites history and garbage-collects Objects unreachable from the successor generation.
- **Deleted:** the Library section containing captures that are logically deleted but still retained and restorable.
- **Reclaim deleted storage:** acceptable explanatory UI copy for Vault Vacuum; the operation name remains `Vault Vacuum` in architecture and diagnostics.

Do not call this Projection compaction. Projection compaction only rebuilds disposable derived state. Do not call Vault Vacuum Secure Scrub: this first design does not rotate the Vault Root Key or guarantee erasure from exports, old Backup Sets, or offline replicas.

## 15.2 User-visible lifecycle

```text
Library
  │ Delete capture / Delete collection
  ▼
Deleted ── Restore ──▶ Library
  │
  │ Vacuum Vault (all currently deleted captures)
  ▼
Successor Vault Generation ──▶ garbage collection ──▶ reclaimed storage
```

The main Library and Deleted are two sections of one rebuildable Library Projection. Active collections remain the primary Library grid. Deleted appears directly below it as a native accordion labeled with its capture count; it is collapsed by default and expands in place through its disclosure arrow. It is not a competing top-level navigation destination. Returning from deleted detail or history reopens the accordion. Both sections group captures by the existing normalized page key. A URL may appear in both when some of its captures are active and others are deleted.

Required behavior:

1. `Delete capture` records the explicit Bundle ID selected by the user and moves only that capture to Deleted.
2. `Delete collection` snapshots the collection's explicit Bundle IDs at confirmation time and deletes those captures atomically. A concurrent or later capture is not included and may form the collection again.
3. Deleting the final active capture makes the active collection disappear naturally.
4. Deleted captures retain their encrypted Bundle, full detail view, bounded thumbnail, original-site link, MHTML download, title, URL, timestamp, and collection grouping.
5. `Restore capture` restores one explicit Bundle ID. `Restore collection` restores the explicit deleted Bundle IDs shown at confirmation time.
6. Restored captures immediately leave Deleted, return to the main Library, and are ineligible for the next Vacuum.
7. Deleted shows capture count, exact retained Bundle bytes where known, and a conservative reclaimable-byte estimate. All user-visible byte counts use compact human-readable binary units such as `824 B`, `12.4 KiB`, or `3.1 MiB`; raw byte integers remain available only in typed Runtime results. Shared bytes count as reclaimable only when no retained Object references them.
8. Deleted contains the only `Vacuum Vault` control. One run processes every capture in Deleted at the Job's snapshot boundary; there is no per-item or per-collection Vacuum in this version.
9. Vacuum never runs automatically. When the Storage Driver reports meaningful device storage pressure and reclaimable deleted bytes, AWSM may show a non-blocking suggestion linking to Deleted. Cross-platform policy chooses what is meaningful; no architecture-wide fixed byte threshold is required.

Confirmation copy must communicate the actual state transition:

- Delete: name the item or collection and capture count; say it moves to Deleted, remains restorable, and continues using storage until Vault Vacuum.
- Restore: name the item or collection and capture count.
- Vacuum: show deleted capture count and estimated reclaimable bytes; state that it rewrites Vault history, permanently removes those captures from the active Vault, has no undo, and does not remove old exports, Backup Sets, or offline copies.

## 15.3 Commands, Events, and Projection

Replace the current pre-release removal protocol with these canonical requests:

```ts
type DeleteCapturesV1 = {
  version: 1;
  type: "DeleteCaptures";
  bundleIds: readonly string[];
};

type RestoreCapturesV1 = {
  version: 1;
  type: "RestoreCaptures";
  bundleIds: readonly string[];
};

type VacuumVaultV1 = {
  version: 1;
  type: "VacuumVault";
};
```

Commands are local requests and are never synchronized. Decode and validate every Bundle ID, reject an empty list, remove duplicates deterministically, and fail the whole Command if any requested capture is absent from the expected active/deleted state. Collection UI resolves a page key to explicit Bundle IDs before sending a Command; the Runtime never applies deletion to a page key dynamically.

Accepted facts are encrypted authoritative Events:

```ts
type CapturesDeletedV1 = {
  eventType: "CapturesDeleted";
  eventVersion: 1;
  payloadVersion: 1;
  bundleIds: readonly string[];
};

type CapturesRestoredV1 = {
  eventType: "CapturesRestored";
  eventVersion: 1;
  payloadVersion: 1;
  bundleIds: readonly string[];
};
```

They also carry the standard Event header, Vault ID, Device ID, timestamp, and integrity fields. Store Bundle IDs in canonical sorted order. Do not persist page titles, URLs, thumbnails, collection labels, or confirmation text in these Events.

Extend `LibraryItemV1` with canonical logical state `status: "Active" | "Deleted"`. Projection replay applies `BundleRegistered`, `CapturesDeleted`, and `CapturesRestored` sequentially. Repeating an already accepted Event ID is idempotent; contradictory state requested by a new Command is rejected rather than silently ignored. Main Library lists Active rows; Deleted lists Deleted rows. Detail lookup accepts both states and returns the state so the UI exposes the correct actions.

Commit each delete/restore Event and all affected encrypted Projection rows in one IndexedDB transaction. A crash may expose either the complete old state or complete new state, never a partial collection transition. Bundle Objects and registration Events remain immutable and present until Vault Vacuum activates a successor generation.

## 15.4 Vault Generation format

Add a formal specification at `docs/specifications/vault/vacuum.md` and an intent/trade-off document at `docs/architecture/21-vault-history-rewrite.md`. The formal specification owns the following contract.

Every Vault has one active generation. The stable Vault ID does not change. Generation zero is created with the Vault in the single canonical pre-release schema; do not infer it for an older local database.

Represent a generation with an encrypted authoritative `VaultGenerationManifest` Object containing at least:

- format version;
- Vault ID;
- generation number and generation ID;
- predecessor generation ID as audit/lineage metadata, not a live Object reference;
- creation timestamp and initiating Device ID;
- reason (`Initial` or `Vacuum`);
- ordered authoritative Event/Event Log Segment roots;
- authoritative Object reachability manifest;
- integrity algorithm and checksum.

The predecessor identifier must not keep the predecessor Object graph reachable. Vault membership is determined only from the active generation and Objects reachable from it. The active generation pointer is small operational coordination state and is changed only through compare-and-swap from the generation observed at Job start.

For append-only work accepted after a manifest is created, the local active pointer also carries canonical opaque Object/Event append-tail identifiers updated atomically with each authoritative commit. The complete active root is the immutable manifest plus this tail. Vacuum verifies that the union exactly covers authoritative storage and folds retained tail entries into the successor manifest, whose tail starts empty. This is operational reachability state, not a mutable authoritative Object or synchronized Projection.

Retained immutable Objects may be referenced unchanged by the successor. An affected Event Log Segment receives a new Object ID. For an Event that references both retained and deleted captures, a registered rewrite handler creates the equivalent retained Event with a new Event ID and integrity data. An Event concerning only deleted captures is omitted. `CapturesDeleted`/`CapturesRestored` Events whose referenced captures are all omitted are also omitted. The successor must replay to the same active logical state as immediately before Vacuum, with Deleted empty.

Every authoritative Object and Event type must register dependency enumeration and rewrite behavior. Encountering an unknown or unsupported type aborts before activation. Never guess that an unknown Object is safe to delete, and never discard unknown fields from a rewritten supported structure.

## 15.5 Vault Vacuum Runtime Job

Add `Vault Vacuum Job` to the Runtime Job vocabulary. Implement it behind a Runtime Service; UI, Host, and Driver code must not perform reachability or deletion policy directly.

The Job stages are normative:

1. **Preflight:** require an unlocked Vault, load the active generation, verify it, and snapshot every capture currently in Deleted.
2. **Quiesce:** prevent new authoritative writes from committing against the observed generation. Reads remain available. Capture/delete/restore commits wait or fail retryably; never lose them.
3. **Analyze:** enumerate the complete dependency graph, calculate retained and unreachable Objects, and calculate conservative reclaimable bytes.
4. **Rewrite:** create new Event/Event Log Segment Objects where deletion changes their contents; reuse unaffected immutable Objects; create the successor manifest with generation number incremented by one.
5. **Verify:** verify every referenced Object, replay the successor Event history, rebuild Projections in an isolated staging area, prove that pre-Vacuum Active state is equivalent and Deleted is empty, and prove that no successor reference points at an omitted Object.
6. **Activate:** atomically compare-and-swap the active generation pointer. If the source generation changed, discard staged state and retry from Preflight; do not merge guessed state.
7. **Materialize:** atomically publish the verified staged Library/Search Projection Materializations for the successor.
8. **Collect:** delete only Objects unreachable from the active successor generation. Collection is resumable and may finish asynchronously.
9. **Complete:** report actual bytes reclaimed, deleted capture count, retained Object count, and excluded-copy warning without logging plaintext identifiers or content.

Failure semantics:

- Failure before Activate leaves the predecessor authoritative and makes staged Objects eligible temporary garbage.
- Failure after Activate leaves the successor authoritative; Materialize/Collect resume from durable Job checkpoints.
- Garbage collection never runs from an unverified or inactive manifest.
- Shared Objects/Blocks remain while any retained Object references them.
- Cancellation is allowed before Activate. After Activate, the Job may stop only at a safe checkpoint and must resume cleanup; it cannot roll back to the predecessor.

The initial browser slice may implement only local generation activation and local garbage collection, but it must use the same Runtime interfaces and persisted format. Do not fake synchronization success or claim remote deletion.

## 15.6 Synchronization, Backup, and restore boundaries

Reconcile `vault/vault.md`, the Event specifications, Object Store and Runtime Storage specifications, Runtime Jobs, synchronization protocol/service, Backup/Restore, content storage, glossary, testing strategy, and the consistency review's affected claims.

Synchronization rules for the formal design:

- Handshakes and cursors include opaque active generation number and root ID. The Coordination Server does not inspect the encrypted manifest or content graph.
- Generation activation uses compare-and-swap. Submissions from a superseded generation fail with a stable `VAULT_GENERATION_SUPERSEDED` error and cannot resurrect omitted Objects.
- A stale replica with no unpublished authoritative work resets to the active generation.
- A stale replica with unpublished work is quarantined for explicit recovery/import. It never merges automatically into the active generation and is not deleted silently.
- The generation number/root identifier is accepted coordination metadata leakage and must be documented as such.

Backup/restore rules:

- Vacuum does not inspect, rewrite, or delete old Backup Sets, exports, or offline replicas.
- A Backup Set from a superseded generation cannot merge into the active generation. It may be restored only into an isolated retired generation or a new Vault for manual recovery.
- UI and documentation must not call Vacuum cryptographic erasure or secret scrubbing.
- A future Secure Scrub design may add retained-data re-encryption, root-key replacement, backup destruction, and replica acknowledgements; none belongs in this implementation.

## 15.7 Concrete implementation map

Start by reading `AGENTS.md`, this entire plan, design principles, glossary, Vault/Event/Object Store specifications, Runtime Job strategy, and the current extension implementation. Work single-agent. Preserve all unrelated user changes.

Implement in this order:

1. **Pure domain and reducers:** replace removal types with delete/restore types; add `status`; implement deterministic reducer transitions, grouping by status, explicit Bundle-ID collection snapshots, dependency enumeration, and rewrite-plan calculation as pure functions.
2. **Encrypted Event preparation:** replace `runtime/library/removal.ts` with delete/restore preparation through one Runtime Service. Keep encryption domains and canonical CBOR rules. No Host or Driver owns business rules.
3. **IndexedDB boundary:** replace the pre-release database schema directly. Add generation manifests, active-generation pointer, durable Vacuum Job/checkpoint data, and staging stores needed for atomic activation. Use a fresh canonical database name/schema rather than an upgrade path for the current development database. Delete obsolete removal APIs and tests.
4. **Application protocol/background:** replace `RemoveLibraryGroup` with `DeleteCaptures`, `RestoreCaptures`, `ListDeleted`, and `VacuumVault`; add typed progress/result state. Background wiring delegates to Runtime Services and maps stable error IDs.
5. **Library UI:** render Deleted as a count-labeled accordion below the primary Library grid, collapsed by default rather than as top-level navigation. Add delete actions to individual capture detail/history and collection cards; add restore actions inside Deleted; preserve breadcrumbs, thumbnails, original-site links, and offline detail/download behavior. Put Vacuum and its estimate only inside the expanded Deleted accordion.
6. **Generation/Vacuum Runtime:** implement staged analysis, rewrite, verification, atomic activation, and resumable collection. Keep all decrypted graphs in trusted Runtime memory, wipe sensitive temporary byte arrays where applicable, and never expose plaintext in Job records or diagnostics.
7. **Documentation reconciliation:** create the two owning documents named above and update every affected consumer atomically. Remove stale statements that hidden Bundles always remain addressable or that `LibraryGroupRemoved` is canonical.

Likely current entry points include:

- `apps/browser-extension/src/runtime/library/` for Projection, delete/restore, grouping, detail, and rewrite planning;
- `apps/browser-extension/src/drivers/indexeddb/` for atomic commits, generation activation, staging, and garbage collection;
- `apps/browser-extension/src/app/{protocol,background}.ts` and `entrypoints/library/` for requests and UI;
- `apps/browser-extension/src/domain/contracts.ts` for persisted canonical types;
- `apps/browser-extension/tests/{unit,integration,e2e}/` for the required RED-to-GREEN evidence.

Do not treat these paths as permission to collapse Runtime/Host/Driver boundaries. Search the current tree before editing because the plan may outlive refactors.

## 15.8 Mandatory TDD sequence

Use strict RED → GREEN → REFACTOR. Record each intentional RED failure and final command output in `02-chrome-extension-capture-vertical-slice-tdd-evidence.md`.

### Phase A: deletion and restoration

Write failing unit tests proving:

- one capture moves Active → Deleted and can return Deleted → Active;
- deleting/restoring a collection uses the explicit snapshot of Bundle IDs;
- a concurrent/later same-URL capture survives collection deletion;
- deleting the final active item removes only the active collection;
- a URL can appear in Active and Deleted simultaneously;
- duplicate IDs, missing IDs, empty Commands, and contradictory state fail without partial transitions;
- Projection replay is deterministic and duplicate accepted Event IDs are idempotent.

Then add failing IndexedDB integration tests proving each Event plus every affected Projection row commits atomically and immutable Bundle/registration records remain.

### Phase B: Deleted UI

Write failing UI-model and packaged-Chrome tests proving:

- Deleted is a collapsed-by-default accordion below Library and shows count/retained bytes when expanded;
- deleted collections retain distinct per-capture thumbnails;
- deleted detail remains viewable offline and can download MHTML;
- item and collection restore work;
- cancelling delete/restore/Vacuum confirmation changes nothing;
- Delete and Vacuum confirmations use the required recoverability language;
- Vacuum is absent from the active Library and present in Deleted only;
- a storage-pressure suggestion links to Deleted and never starts Vacuum.

### Phase C: generations and rewrite

Write failing pure/runtime tests proving:

- a successor increments generation while preserving Vault ID;
- predecessor ID metadata does not make predecessor Objects reachable;
- unaffected Objects retain identifiers and bytes;
- fully deleted Events disappear;
- mixed-reference Events are rewritten with new IDs while retaining supported unknown fields;
- an unknown Object/Event type aborts before activation;
- replayed Active state is equivalent and successor Deleted is empty;
- shared Objects remain reachable and byte estimates do not double-count them.

### Phase D: crash safety and garbage collection

Write failing real-browser integration tests at every durable Job boundary:

- interruption before activation retains the predecessor and all data;
- source-generation compare-and-swap conflict activates nothing;
- interruption immediately after activation exposes only the successor;
- restart resumes Materialize/Collect;
- unreachable Objects are deleted and actual storage counts/bytes decrease;
- retained Bundle detail and MHTML remain valid after collection;
- staged temporary Objects are reclaimable after failed pre-activation work.

### Phase E: synchronization contract tests

If synchronization is not implemented in this slice, add contract tests and fixtures without pretending they are end-to-end. They must prove generation fields round-trip, stale generation submission returns `VAULT_GENERATION_SUPERSEDED`, and superseded Backup/Restore input cannot merge. Mark remote propagation as deferred in evidence.

## 15.9 Verification gates and completion criteria

Discover scripts from the current manifest. At the time this section was written, the minimum local gates were:

```bash
cd apps/browser-extension
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm build
```

Implementation is complete only when:

- all obsolete `LibraryGroupRemoved`/`RemoveLibraryGroup` code, tests, and normative plan language are removed or explicitly marked superseded;
- one-item and collection deletion/restoration work atomically;
- Deleted preserves offline inspection until Vacuum;
- Vacuum activates only a fully verified successor generation;
- a real browser test proves storage records decrease without harming retained captures;
- no plaintext capture content or identifiers appear in diagnostics, operational Job rows, or unencrypted coordination data;
- all verification gates pass from a clean pre-release Vault;
- evidence records test counts, intentional RED failures, deferred synchronization coverage, and the explicit limitation that old backups/offline copies are not scrubbed.
