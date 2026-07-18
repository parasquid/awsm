# Object Store Specification

**Document:** `specifications/storage/object-store.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Object Store provides the canonical persistence layer for immutable authoritative Objects.

The Object Store is independent of:

- browser APIs
- filesystem APIs
- cloud storage providers
- synchronization protocols

Implementations may store Objects in OPFS, local filesystems, relational databases, object storage services, or other persistence mechanisms.

---

# 2. Design Goals

The Object Store MUST provide:

- immutable storage
- deterministic retrieval
- integrity verification
- implementation independence
- efficient streaming

---

# 3. Object Model

Every stored Object consists of:

- Object Identifier
- Object Type
- Object Version
- Payload
- Integrity Information

The Object Store treats the payload as opaque bytes. Object semantics are authoritative only through the specification that defines the Object Type.

---

# 4. Object Types

The storage layer recognizes only broad storage categories.

Examples include:

- Bundle
- Event
- Block
- WrappedKey
- EventLogSegment
- ProjectionSnapshot

Interpretation of Object contents is delegated to higher-level specifications.

---

# 5. Operations

Every implementation SHALL support:

- PutObject
- GetObject
- HasObject
- DeleteObject
- ListObjects
- VerifyObject

---

# 6. Immutability

Objects MUST NOT be modified after successful storage.

Replacing an Object requires storing a new Object with a different identifier.

---

# 7. Streaming

Implementations SHOULD support streaming writes and reads.

Large Objects SHOULD NOT require complete in-memory buffering.

---

# 8. Integrity

Every Object MUST possess integrity metadata.

Integrity verification SHALL occur before the Object is returned to higher layers.

---

# 9. Namespaces

Objects MAY be partitioned internally.

Partitioning SHALL NOT affect Object identifiers.

---

# 10. Storage Independence

Implementations MAY use:

- OPFS
- IndexedDB
- Local filesystem
- SQLite
- Object storage services
- Other persistent stores

Storage backends SHALL expose identical semantics.

---

# 11. Deletion

Deletion removes the local replica only.

Deletion does not redefine the logical history of the Vault.

Retention policies are defined elsewhere.

Vault Vacuum is the supported retention policy defined by `docs/specifications/vault/vacuum.md`. It removes only Objects proven unreachable from the verified active successor Vault Generation.

---

# 12. Invariants

Objects are immutable.

Object identifiers are stable.

Payloads are opaque.

Integrity verification is mandatory.

Objects are the authoritative persistence records; higher-level specifications define how Object Types such as Bundles, Event Log Segments, and Wrapped Keys affect Vault state.

---

# References

bundle/bundle.md

vault/vault.md

core/identifiers.md
