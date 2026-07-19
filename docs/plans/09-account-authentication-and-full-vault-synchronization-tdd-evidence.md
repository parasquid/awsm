# Account Authentication and Full Vault Synchronization TDD Evidence

**Document:** `docs/plans/09-account-authentication-and-full-vault-synchronization-tdd-evidence.md`
**Status:** Implementation evidence
**Owner:** Engineering
**Last Updated:** 2026-07-19
**Plan:** `docs/plans/09-account-authentication-and-full-vault-synchronization.md`

---

# Purpose

This record preserves RED → GREEN → REFACTOR evidence for Plan 09 and the final verification and
rendered-inspection audit. It does not weaken any Plan 09 acceptance criterion.

# TDD Evidence

## Account cryptography and persistence

**RED:** Account vector, substitution, normalization, envelope-binding, non-exportable key, restart,
logout, session rotation, replay, and one-Vault constraint tests were introduced before the Account
Runtime, IndexedDB stores, Rails models, and public resources existed.

**GREEN:** The client matches the committed Argon2id13, HKDF-SHA256, and XChaCha20-Poly1305 vectors;
the server stores only BCrypt/digest authentication material and opaque envelopes; IndexedDB stores
non-exportable wrapping keys and encrypted refresh/Account-key material.

**REFACTOR:** Account password derivation, wire encoding, HTTP transport, persistence, and session
refresh are separate Services. Logout erases Account secrets without deleting device-local Vault
authority.

## Server choice, login, and signup

**RED:** popup view/protocol and packaged-browser tests failed until first launch required an
explicit hosted, self-hosted, or local-only choice and signup existed as an extension-owned tab.

**GREEN:** exact optional origin permission, strict origin validation, redirect rejection,
compatible-server probing, popup login, full-tab signup, recovery acknowledgement, and existing/new
Vault choice were implemented.

**Browser RED discovered during black-box integration:** the packaged extension remained on
“Choose synchronization” with `STORAGE_TRANSACTION_FAILED`. Chrome had rejected
`permissions.request()` because the request crossed into the service worker after user activation
was lost.

**Browser GREEN:** popup and Library settings now request the exact validated origin during their
user gesture. The background Host independently confirms permission, probes with redirects and
credentials disabled, and commits only a compatible origin.

## Full Replica synchronization

**RED:** enrollment, discovery, upload-order, canonical pull, remote bootstrap, Cable, and
large-Artifact tests failed against absent Runtime Services and persisted Job/checkpoint stores.

**GREEN:** dependency-first upload, idempotent checkpoints, fixed change fences, canonical Event
replay, Complete Replica validation, polling, content-free Cable hints, and bounded streaming beyond
4 GiB were implemented.

**Browser RED discovered during black-box integration:** the first real packaged-client signup
failed before issuing `POST /api/accounts`; the Worker reported `TypeError: Failed to execute
'fetch' on 'WorkerGlobalScope': Illegal invocation`.

**Browser GREEN:** Account and synchronization HTTP clients invoke native fetch with
`WorkerGlobalScope` as receiver. `tests/unit/http-receiver.test.ts` preserves the regression, and
the packaged two-profile test signs up, logs in, bootstraps, and converges a rename through actual
Rails, PostgreSQL, opaque Disk storage, and extension IndexedDB.

## Synchronized Vacuum and stale recovery

**RED:** server-first Vacuum ordering, persisted remote/local activation checkpoints, stale conflict,
fresh-identity fork, export-first warnings, and atomic replacement tests failed against the prior
local-only Vacuum and absent recovery path.

**GREEN:** synchronized Vacuum journals its candidate before remote compare-and-swap, records the
remote cursor before local activation, and resumes after restart. Stale resolution recommends exact
Complete Export, requires explicit overwrite/skip confirmation, preserves the current logical state
under fresh local-only identities, and atomically installs the verified server Replica.

**REFACTOR:** the recovery builder reuses canonical Capture, Collection, Projection, Artifact, and
Generation validators without treating the result as Import or Restore. Browser IndexedDB failure
injection proves all 23 compact activation writes roll back together. The current-state fixture
contains active and deleted Captures, warnings, multiple Artifact roles/plaintexts, and Collection
topology.

## Server security and operations

**RED:** the credential-sentinel request spec initially exposed Account-key/ciphertext parameter
names not covered by filtering. An unknown login email also skipped BCrypt while a wrong secret for
an existing Account performed BCrypt, leaving a timing oracle.

**GREEN:** secret filtering covers password, authentication secret, tokens, Cable ticket, Account
key, envelope/ciphertext, and KDF salt families. Login performs exactly one BCrypt verification
against a real or synthetic digest and returns the same outcome. Cable tickets are one-use,
digest-only, Account-bound, TTL-limited, scrubbed from retained request URL state, and channel tests
reject another Account's Vault.

**REFACTOR:** expired Cable-ticket cleanup is periodic rather than per-request persistence churn.
Redis migration remains a Roadmap Candidate, together with evaluating the Redis Action Cable
adapter once Redis is an approved dependency.

# Rendered Visual Inspection

The packaged-Chromium visual scenarios captured and the image-inspection tool viewed these Account
states:

- server choice at 420×760 and 340×700;
- login with visible Email focus at 420×760;
- signup resting/focused at 720×900 and narrow at 360×760;
- password-confirmation validation alert;
- disabled signup with visible synchronization progress;
- successful signup with credential form removed;
- Account/settings dialog at 1280×720 and 360×760; and
- stale-Replica export-first dialog at desktop and narrow widths, confirmed overwrite, busy, and
  failure states.

Inspection findings:

- controls retain meaningful dimensions and visible focus;
- hosted-origin and warning copy wrap without horizontal clipping;
- signup spacing and input widths remain coherent at narrow width;
- validation, progress, and success use a stable prominent status region;
- the success form originally remained visible because author `display: grid` overrode `hidden`;
  `[hidden]` now removes it and the rerendered success state was inspected;
- the narrow settings dialog keeps viewport margins, wraps the synthetic email, and keeps checkbox
  and action geometry usable; and
- stale-recovery confirmation geometry, progress movement, error prominence, and modal margins were
  inspected after the viewport-width and checkbox-alignment corrections.

# Focused Green Commands

```text
corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/http-receiver.test.ts
  1 file, 2 tests passed

corepack pnpm --filter @awsm/browser-extension exec vitest run tests/unit/synchronization-recovery-fork.test.ts
  1 file, 2 tests passed

corepack pnpm --filter @awsm/browser-extension exec playwright test tests/integration/indexeddb.browser.test.ts --project=chromium --grep 'stale Replica'
  1 test passed

corepack pnpm --filter @awsm/browser-extension exec playwright test tests/integration/indexeddb.browser.test.ts --project=chromium --grep 'synchronized Vacuum remote'
  1 test passed

corepack pnpm exec playwright test -c playwright.e2e.config.ts --grep 'converges two packaged'
  1 test passed

corepack pnpm exec playwright test -c playwright.e2e.config.ts --grep 'renders Account onboarding'
  1 test passed; all generated screenshots inspected

docker compose exec -T -e RAILS_ENV=test -e AWSM_SYNTHETIC_ACCOUNT_SECRET=test-only-synthetic-account-secret coordination-server bundle exec rspec spec/requests/authentication_spec.rb spec/channels/vault_changes_channel_spec.rb
  10 examples, 0 failures
```

# Final Verification Matrix

The complete matrix is intentionally recorded only from the final current worktree:

| Command                                   | Final result            |
| ----------------------------------------- | ----------------------- |
| `corepack pnpm lint`                      | 175 files, no issues    |
| `corepack pnpm typecheck`                 | Passed                  |
| `corepack pnpm test`                      | 51 files, 206 passed    |
| `corepack pnpm test:integration`          | 33 passed               |
| `corepack pnpm test:e2e:chrome`           | 7 passed                |
| `corepack pnpm build`                     | Passed                  |
| `corepack pnpm test:sync-proof`           | Passed                  |
| Documentation Prettier check              | Passed                  |
| `git diff --check`                        | Passed                  |
| Coordination Server `bin/rubocop`         | 105 files, no offenses  |
| Coordination Server `bin/bundler-audit`   | No vulnerabilities      |
| Coordination Server `bin/importmap audit` | No vulnerable packages  |
| Coordination Server Brakeman              | No warnings             |
| Coordination Server RSpec                 | 43 examples, 0 failures |
| Coordination Server `bin/ci`              | Passed in 10.40s        |
