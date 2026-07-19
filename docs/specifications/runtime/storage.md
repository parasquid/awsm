# Storage Service Specification

**Document:** `specifications/runtime/storage.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Storage Service provides persistent local storage for Vault replicas.

The Storage Service exposes object-oriented storage independent of any specific persistence backend.

---

# 2. Design Goals

The Storage Service MUST provide:

- offline persistence
- integrity verification
- atomic operations
- backend independence
- efficient streaming
- resumable writes

---

# 3. Architecture

```
Runtime

↓

Storage Service

↓

Storage Driver

↓

Persistence Backend
```

The Storage Service owns storage semantics.

Drivers adapt those semantics to platform-specific storage.

---

# 4. Responsibilities

The Storage Service coordinates:

- object persistence
- object retrieval
- object verification
- transaction management
- cache management
- garbage collection

---

# 5. Storage Drivers

Drivers MAY include:

- OPFS
- Local Filesystem
- SQLite
- IndexedDB
- In-Memory (testing)

Drivers SHALL expose identical semantics.

---

# 6. Object Model

The Storage Service stores immutable Objects.

Objects include:

- Bundle Descriptors
- Artifacts
- Blocks
- Wrapped Keys
- Event Log Segments
- Projection Snapshots
- AI Artifacts

Objects are opaque to the Storage Driver.

---

# 7. Core Operations

The Storage Service SHALL provide:

- StoreObject
- LoadObject
- HasObject
- DeleteObject
- VerifyObject
- EnumerateObjects

Operations are defined in terms of Object Identifiers rather than file paths.

---

# 8. Transactions

The Storage Service SHALL support atomic transactions.

A transaction MUST either:

- commit all changes, or
- commit none.

Partially committed state is prohibited.

---

# 9. Integrity Verification

Before returning an Object, the Storage Service SHALL verify:

- object existence
- checksum or hash
- encryption envelope integrity (where applicable)

Corrupted objects SHALL be reported to the caller.

---

# 10. Streaming

Large Objects SHALL support streaming reads and writes when their owning format requires it.

Implementations SHOULD avoid buffering complete Objects in memory.

---

# 11. Caching

The Storage Service MAY maintain transient caches.

Caches MUST be rebuildable.

Caches SHALL NOT become authoritative.

---

# 12. Garbage Collection

The Storage Service MAY reclaim:

- orphaned temporary files
- abandoned transactions
- obsolete caches

Authoritative Objects SHALL NOT be removed except through defined retention policies.

Vault Vacuum is such a policy. A Storage Driver MUST make successor activation and local reclamation appear atomic, either in one transaction or through a durable resumable post-activation Job.

---

# 13. Recovery

Following unexpected termination, the Storage Service SHALL:

- detect incomplete transactions
- remove temporary artifacts
- verify persistent state
- resume normal operation

---

# 14. Driver Requirements

Every Storage Driver SHALL provide:

- durability
- atomic rename or equivalent commit primitive
- directory enumeration
- binary streaming
- random object lookup

Where the underlying platform lacks a primitive, the driver SHALL emulate equivalent behavior.

---

# 15. Browser Drivers

The initial browser extension implementation SHALL use an IndexedDB Driver for compact records and
an Artifact Store Driver for encrypted Artifact wrappers.

It SHALL:

- persist immutable encrypted Objects and Events
- persist encrypted Projection rows separately from authoritative Objects
- persist operational Jobs and command outcomes
- use one versioned database
- provide atomic transactions across Bundle Descriptor and Artifact records, Event, Projection,
  Generation, and command-outcome writes
- isolate storage by extension origin

Its Artifact Store SHALL prepare encrypted wrappers in a Vault-scoped OPFS namespace, stream reads
and writes, validate exact wrapper integrity, remove failed preparations, and reconcile orphan files
against authoritative records at startup. Platform APIs remain behind the Driver.

The Runtime MUST NOT depend upon IndexedDB-specific or OPFS-specific APIs outside the selected Driver.

Complete Vault Import SHALL stage its encrypted source through a Host-owned, Job-derived temporary
file using bounded streaming. Validated Artifact wrappers are copied byte-for-byte to their
destination Vault scope and checked against authoritative length and SHA-256 before activation.
Compact Vault records, rebuilt Projections, encrypted name cache, directory entry, conditional
active-Vault selection, and Import success SHALL commit in one Driver transaction. Failure before
commit removes the source and exact prepared wrappers; restart cleanup SHALL first prove that no
destination directory entry committed.

Every Workspace or Vault mutation transaction SHALL include the Import lease store and reject a
non-terminal Import before its first write. Runtime-only prechecks do not replace this transaction
fence.

---

# 16. Diagnostics

The Storage Service SHOULD expose:

- total object count
- storage utilization
- free capacity (when available)
- verification failures
- transaction failures

---

# 17. Invariants

Objects are immutable.

Drivers are interchangeable.

Transactions are atomic.

Verification precedes object access.

Persistent state survives Runtime restarts.

---

# References

storage/object-store.md

runtime/runtime.md

vault/vault.md
