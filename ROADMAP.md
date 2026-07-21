# AWSM Roadmap

This roadmap records unresolved future product initiatives. It is not an implementation history,
architecture specification, or authorization to build. Decision-complete work requires an approved
numbered plan and reconciliation with the owning specifications.

## Initiative Statuses

- **Discovery:** the problem, feasibility, or major architectural choices remain open.
- **Candidate:** the direction is coherent, but scope, dependencies, or acceptance criteria remain
  open.
- **Approved:** explicitly approved for conversion into a numbered implementation plan.

---

## Redis-Backed Ephemeral Coordination

**Status:** Candidate

Replace PostgreSQL-backed one-use Cable ticket rows with atomic, TTL-bound digest entries in Redis
after Redis becomes an approved Coordination Server dependency. Evaluate using that same Redis
deployment as the Action Cable adapter so multi-process hint delivery and ephemeral authentication
share one operational dependency. The implementation plan must preserve 60-second expiry,
Account binding, atomic one-use consumption, digest-only storage, and polling as the sufficient
synchronization path when hints are lost.

---

## Preserve-First Stale Replica Recovery

**Status:** Candidate

Add an explicit alternative to destructive stale-Replica discard. Retrieve every stale payload from
the retained Recovery Snapshot, decrypt and re-encrypt the complete stale state under fresh Vault,
Generation, Event, Object, Bundle, Artifact, Collection, key, and device identities, and activate it
as a local-only Vault only after complete validation. This future flow must preserve bounded
streaming, remain distinct from Import/Restore, and never weaken the current export-first discard
contract.

---

## Native Download Boundary Journey Proof

**Status:** Candidate

Add a test-only Download Host that replaces only the native save-file interaction which packaged
headless browsers cannot reliably automate. Use it to complete the successful Export branch of
stale-Replica discard and prove that the emitted encrypted Vault Package imports into a fresh
local-only Vault. The test Host must exercise the production Runtime encryption, package creation,
validation, and recovery sequencing without granting the shipped extension broader permissions or
bypassing the real Host in release builds.

---

## Firefox Extension Host

**Status:** Discovery

Define and implement Firefox as a supported extension Host rather than treating Chrome-specific
behavior as portable by assumption. Resolve manifest and background lifecycle differences, storage
and download Drivers, permissions, native-dialog behavior, packaging, signing, and update delivery.
Run the shared Runtime conformance suites and the first-use, capture, synchronization, stale-Replica
recovery, Export, Import, lock, and live-Projection journeys against a packaged Firefox build. Any
Firefox-specific accommodation must remain behind Host or Driver boundaries and must not fork the
canonical Vault, Account, synchronization, or cryptographic contracts.

---

## Zero-Knowledge Synchronized Web Client

**Status:** Candidate

**Potential product surface:** a configurable production web origin, currently referred to as
`awsm.foo`.

The Chrome extension and Coordination Server already own email/password Account authentication,
client-only Account-key enrollment, one synchronized Vault Replica, background convergence,
manual heavy-Artifact storage relief, on-demand retrieval, Generation fencing, and stale-Replica
discard. This initiative must reuse those canonical Runtime
and protocol contracts; it must not create a second Account, key, or synchronization model.

Future web scope remains limited to:

- a trusted web Host for Library browsing, organization, local Search, Export, Import, and Account
  management;
- persistent Full and Selective retention profiles, automatic policies, pinning, and production
  quota controls beyond the implemented manual storage-relief and quota-fallback UX;
- Device enrollment, signed requests, revocation, and Account Recovery Key ceremonies;
- password change and recovery after every enrolled browser is lost;
- production quotas, abuse controls, billing, shared immutable-byte storage, backup/restore, and
  multi-process deployment hardening; and
- optional passkeys or other authentication methods only through a separately approved contract.

Capture remains extension-only for the first web-client scope. A web Host must never bridge into
extension-local storage or transfer plaintext outside the encrypted synchronization protocol.

Before promotion, resolve browser support, web-Host storage-clear recovery, retention defaults, final-copy
deletion policy, selective Import semantics, quota accounting, and the production threat model.
Required evidence includes independent cryptographic review, multi-client fault injection,
bounded-memory transfers beyond 4 GiB, authenticated omission versus corruption tests, lifecycle and
accessibility inspection, and proof that no plaintext or content-derived metadata crosses the server
boundary.
