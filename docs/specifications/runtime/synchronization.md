# Runtime Synchronization Service

**Document:** `specifications/runtime/synchronization.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- runtime.md
- ../protocol/protocol.md
- ../event/event-format.md

---

# Purpose

This specification defines trusted Runtime responsibilities for the implemented opaque
Coordination Server integration.

# Responsibilities

The Synchronization Service SHALL encrypt and semantically validate local authoritative records,
maintain independent local Replica state, upload dependencies before Events, retain local content
until durable closure acknowledgement, fetch snapshot-bounded changes, download and verify opaque
bytes, and replay Events in canonical Event order rather than Delivery Cursor order.

It SHALL subscribe before initial fetch, treat Action Cable only as a wake-up, generation-guard
reconciliation, poll after missed lifecycle events, and converge when every hint is lost.

# Coordination Server Switching

Changing Coordination Servers is a persisted reconciliation operation, not logout followed by new
onboarding. The Runtime SHALL keep the source Account, source coordinator, and source Cable active
while it probes and authenticates an isolated candidate context. A failed probe, authentication,
Vault mismatch, integrity failure, or read-only conflict MUST leave the source context active and
capable of synchronizing later mutations.

The Runtime SHALL accept either an empty candidate Account or exactly one candidate Vault with the
same Vault ID and cryptographically verified Root Key. It SHALL authenticate every immutable byte
and dependency closure before classification. It SHALL classify only these outcomes:

- `PublishLocal` when the candidate Account is empty;
- `Union` when both Replicas name the same Generation and their immutable intersection agrees;
- `FastForwardCandidate` when the local direct successor and the candidate's exact recovered base
  prove candidate ancestry;
- `FastForwardLocal` when the candidate direct successor and the source's exact recovered base prove
  local ancestry; or
- conflict when ancestry is unavailable or Generations diverged.

Numeric Generation order alone is never ancestry proof. Different Vault IDs are a candidate failure;
the same Vault ID with a different Root Key or immutable bytes is an integrity failure. The Runtime
MUST NOT overwrite either side to resolve a switch conflict.

Candidate uploads SHALL publish dependencies before Events and use persisted idempotency
checkpoints. Local Replica activation, active Account credential promotion, candidate server
configuration, Projections, name cache, and synchronization state SHALL commit in one IndexedDB
transaction. Only after that commit may the Runtime replace the coordinator, revoke the prior
session, and erase prior credentials. A response from the source context MUST NOT commit after
promotion.

A candidate-head race before any candidate authority changes permits one fresh comparison. The
Runtime SHALL journal the first Event whose returned Delivery Cursor proves that the candidate
accepted new authority before marking its local checkpoint committed. If the candidate Generation
then changes, the operation SHALL terminate as a conflict, retain the source as the active context,
and report truthfully that verified append-only history reached the candidate before the concurrent
change. It MUST NOT retry as a read-only comparison, claim that the candidate was unchanged, or
attempt a compensating deletion.

The persisted Server Switch Job SHALL resume after Worker termination at candidate authentication,
comparison, remote preparation/activation, local preparation/activation, promotion, and prior
revocation. Candidate authentication expiry retains the same Job and expected candidate Account
identity before and after remote application. Locking aborts candidate transport and moves the Job
to `WaitingForUnlock`; unlock revalidates both authority fences before resuming. Byte-identical
prepared Artifact wrappers MAY be reused after validation, while incomplete or mismatched wrappers
MUST be removed and downloaded again.

# Generation Supersession

Every write names the expected active Generation. On supersession or head conflict, the Runtime
quarantines unpublished local work and performs an explicit reconciliation. It MUST NOT silently
reset, merge recovery history, or append against a stale Generation.

# Recovery

On a stale Generation, the Runtime SHALL make the synchronized Vault read-only except for reads and
Complete Export. Resolution SHALL require either a successful Export or an explicit two-part skip
confirmation. It SHALL re-author the stale Replica's current logical state into a fresh local-only
Vault with fresh identities, verify a complete server download, and atomically install the fork
while replacing the original synchronized Vault. No server response may cause partial local
activation. Interrupted preparation SHALL clean uncommitted Artifact wrappers and return to
Conflict. Import, Restore, and stale-Replica recovery remain distinct operations.

Recovery preparation checkpoints are restartable boundaries. If the Runtime restarts while
preparing the recovery fork, preparing server replacement, or awaiting atomic activation, startup
SHALL remove uncommitted recovery-fork Artifact wrappers, clear the provisional fork identity, and
restore the synchronization Job to explicit Conflict. A restart after the atomic activation SHALL
retain the committed server Replica and recovered local-only Vault and continue from their
canonical persisted state.

# Account Scope

One Account owns at most one synchronized Vault. The Runtime creates and retains the Account
Encryption Key only in trusted client storage, sends only its password-wrapped envelope and the
Account-wrapped Vault Root Key slot, and retains the device-local slot for offline access after
logout. Account Commands, credentials, Jobs, checkpoints, Delivery Cursors, and wake-up hints are
operational state and never authoritative Vault history.

Synchronized Vacuum SHALL treat authentication expiry at any remote activation checkpoint as an
authentication boundary, not as local completion. It SHALL retain deleted content and the
journaled candidate, erase authenticated secrets, expose `AuthenticationRequired`, and permit
resume only after successful authentication and current-Replica reconciliation. It MUST NOT commit
local Vacuum deletion before the remote successor Generation is durably activated.

# Operational State

Upload progress, Delivery Cursors, retry schedules, availability, and notification bookkeeping are
local operational state, not authoritative Events and not synchronized content. Commands remain
local requested actions; accepted facts become authoritative Events only through Runtime rules.

# Security

The Runtime rejects malformed identifiers, mismatched immutable metadata, ciphertext checksum or
length failures, rollback, omitted dependency closure, and malicious server responses. Plaintext,
unwrapped keys, Search Materializations, and content-derived metadata never enter protocol requests.
