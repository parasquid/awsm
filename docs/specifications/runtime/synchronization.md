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

# Account Scope

One Account owns at most one synchronized Vault. The Runtime creates and retains the Account
Encryption Key only in trusted client storage, sends only its password-wrapped envelope and the
Account-wrapped Vault Root Key slot, and retains the device-local slot for offline access after
logout. Account Commands, credentials, Jobs, checkpoints, Delivery Cursors, and wake-up hints are
operational state and never authoritative Vault history.

# Operational State

Upload progress, Delivery Cursors, retry schedules, availability, and notification bookkeeping are
local operational state, not authoritative Events and not synchronized content. Commands remain
local requested actions; accepted facts become authoritative Events only through Runtime rules.

# Security

The Runtime rejects malformed identifiers, mismatched immutable metadata, ciphertext checksum or
length failures, rollback, omitted dependency closure, and malicious server responses. Plaintext,
unwrapped keys, Search Materializations, and content-derived metadata never enter protocol requests.
