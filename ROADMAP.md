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

## Zero-Knowledge Synchronized Web Client

**Status:** Candidate

**Potential product surface:** a configurable production web origin, currently referred to as
`awsm.foo`.

The Chrome extension and Coordination Server already own email/password Account authentication,
client-only Account-key enrollment, one synchronized Complete Replica, background convergence,
Generation fencing, and stale-Replica recovery. This initiative must reuse those canonical Runtime
and protocol contracts; it must not create a second Account, key, or synchronization model.

Future web scope remains limited to:

- a trusted web Host for Library browsing, organization, local Search, Export, Import, and Account
  management;
- explicit Full and Selective local retention profiles, on-demand Artifact retrieval, pinning,
  eviction, and quota UX;
- Device enrollment, signed requests, revocation, and Account Recovery Key ceremonies;
- password change and recovery after every enrolled browser is lost;
- production quotas, abuse controls, billing, shared immutable-byte storage, backup/restore, and
  multi-process deployment hardening; and
- optional passkeys or other authentication methods only through a separately approved contract.

Capture remains extension-only for the first web-client scope. A web Host must never bridge into
extension-local storage or transfer plaintext outside the encrypted synchronization protocol.

Before promotion, resolve browser support, storage-clear recovery, retention defaults, final-copy
deletion policy, selective Import semantics, quota accounting, and the production threat model.
Required evidence includes independent cryptographic review, multi-client fault injection,
bounded-memory transfers beyond 4 GiB, authenticated omission versus corruption tests, lifecycle and
accessibility inspection, and proof that no plaintext or content-derived metadata crosses the server
boundary.
