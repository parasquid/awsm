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

This specification defines trusted Runtime responsibilities when integration with the implemented
opaque Coordination Server is approved. The server proof exists; client integration remains future
work.

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

Recovery downloads one exact superseded Generation into an isolated trusted workflow. It never
updates the active head automatically. Import, Restore, and Recovery remain distinct operations.

# Operational State

Upload progress, Delivery Cursors, retry schedules, availability, and notification bookkeeping are
local operational state, not authoritative Events and not synchronized content. Commands remain
local requested actions; accepted facts become authoritative Events only through Runtime rules.

# Security

The Runtime rejects malformed identifiers, mismatched immutable metadata, ciphertext checksum or
length failures, rollback, omitted dependency closure, and malicious server responses. Plaintext,
unwrapped keys, Search Materializations, and content-derived metadata never enter protocol requests.
