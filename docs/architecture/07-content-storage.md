# Content Storage Architecture

**Document:** `architecture/07-content-storage.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/02-domain-model.md
- architecture/06-bundle-format.md

---

# Purpose

This document defines the storage architecture used by Archive Platform.

The storage layer is responsible for durable persistence of encrypted authoritative Objects.

It deliberately has **no understanding** of Archives, Artifacts, or AI.

Its responsibility begins after Bundle encryption.

---

# Design Goals

The storage architecture must provide:

- durability
- scalability
- resumable uploads
- resumable downloads
- integrity verification
- deduplication support
- backend independence

while remaining completely unaware of Bundle semantics.

---

# Storage Pipeline

```text
Bundle

↓

Serialize

↓

Compress

↓

Encrypt

↓

Store As Immutable Object
```

Only encrypted Objects reach the storage layer.

Future synchronization MAY split encrypted Objects into Blocks without changing Bundle or Runtime semantics.

---

# Storage Layers

The storage system consists of three logical layers.

```text
Logical Layer

Vault

↓

Archive

↓

Bundle

──────────────────────────────

Storage Layer

Encrypted Objects

──────────────────────────────

Physical Layer

Object Store
```

Each layer has distinct responsibilities.

---

# Block

A Block is the smallest storage unit.

Every Block contains:

- Block ID
- Payload
- Size
- Checksum
- Storage Version

Blocks are immutable.

---

# Block Identity

Every Block is identified by a content-derived identifier.

Properties:

- globally unique
- immutable
- deterministic
- independent of storage backend

The identifier allows integrity verification.

---

# Block Store

The Block Store provides a simple abstraction.

Operations:

Store Block

Retrieve Block

Delete Block

Check Existence

The Block Store does not understand Bundles.

---

# Local Physical Chunking

A Storage Driver MAY internally map an encrypted Object byte sequence to physical Blocks.

Example:

```text
Encrypted Object A

↓

Block 1

Block 2

Block 3
```

The Driver maintains ordering information required for reconstruction. This mapping is local,
non-authoritative, and absent from the Coordination Server contract.

It never stores plaintext.

---

# Metadata Store

The Metadata Store maintains coordination data.

Examples:

- Vault ID
- Bundle ID
- Block references
- Upload state
- Synchronization sequence
- Retention state

The Metadata Store should remain small.

---

# Object Storage

The physical storage backend stores encrypted Blocks.

Supported implementations may include:

- S3-compatible storage
- MinIO
- Azure Blob Storage
- Google Cloud Storage
- Local filesystem (development)

The Block Store abstracts provider differences.

---

# Local Storage

The Client Runtime maintains its own Object Store.

The initial Chrome Host uses an IndexedDB Driver behind the platform-independent Storage Service.

Authoritative Artifact Object records and device-local wrapper availability are distinct. A missing
wrapper is corruption unless a strict device-local remote-only row names that Artifact. Storage
maintenance may create such a row only after proving the exact local wrapper belongs to the active
server Generation and matches its committed length, checksum, and type. Compact Artifact roles are
not eligible.

```text
Client

↓

Local Object Store

Server

↓

Remote Object Store
```

Synchronization copies canonical opaque Object records and bytes. It does not expose or negotiate a
Driver's derived Blocks.

---

# Upload Process

```text
Object

↓

Encrypted Object bytes

↓

Resumable opaque parts

↓

Finalize durable Object, then publish an Event closure or Vault Generation
```

Publication occurs only after the complete declared closure is durable.

---

# Download Process

```text
Object requested

↓

Authorize an active or recovery-scoped ticket

↓

Download full or ranged Object bytes

↓

Verify exact ciphertext length and SHA-256

↓

Decrypt

↓

Deserialize
```

On-demand retrieval verifies the advertised and received ciphertext before releasing plaintext.
Normal access restores the wrapper locally and clears remote-only state only after the local file is
verified. A quota-specific failure removes partial local bytes, obtains a fresh ticket, and serves a
bounded verified transient stream without clearing remote-only state.

---

# Integrity

Every synchronized Object binds exact ciphertext length and SHA-256. A local Driver that derives
Blocks also binds checksums for those non-authoritative physical units.

Verification occurs:

- after creation
- after upload
- after download
- before reconstruction

Corrupted Blocks are rejected.

---

# Deduplication

The architecture permits deduplication.

The MVP does **not** require it.

Future implementations may reuse identical encrypted Blocks when safe to do so.

The Bundle format remains unchanged.

---

# Garbage Collection

Blocks are immutable.

Deletion is reference-based.

```text
Bundle Deleted

↓

Reference Removed

↓

No Remaining References

↓

Eligible For Deletion
```

Physical deletion may occur asynchronously.

For Vault authoritative Objects, logical deletion alone is insufficient. Vault Vacuum first activates a verified successor Vault Generation; reference-based garbage collection then removes predecessor-only Objects. See `21-vault-history-rewrite.md`.

---

# Storage Versioning

Storage Version identifies the storage representation.

Examples:

- chunking algorithm
- compression algorithm
- block encoding

Changing Storage Version does **not** change Bundle Version.

---

# Performance Goals

The storage layer should optimize for:

- sequential writes
- streaming uploads
- streaming downloads
- minimal memory usage

Storage SHALL avoid loading large Artifacts into memory. The Artifact Store streams encrypted
frames and keeps memory bounded independently of Artifact or Vault size.

---

# Failure Recovery

Interrupted uploads:

Resume.

Interrupted downloads:

Resume.

Missing Blocks:

Retry.

Corrupted Blocks:

Redownload.

Partial Bundle graphs are never committed. Prepared external wrappers are not authoritative until
their descriptor and Artifact records commit atomically; startup reconciliation removes orphan
preparations. A committed record with a missing or corrupt wrapper is corruption.

---

# Design Decisions

## Why Immutable Blocks?

Immutability simplifies synchronization, integrity verification, and replication.

---

## Why Separate Bundle and Storage?

The archival model should remain independent of storage implementation.

---

## Why Object Storage?

Commodity object storage provides durability, scalability, and operational simplicity.

---

## Why Graph Reachability?

Descriptor-to-Artifact reachability allows exact storage reclamation without interpreting payloads.

---

# Import Preparation

An Import staging file is temporary encrypted Host data, not Vault authority. After full package
validation, the Artifact Store streams each encrypted wrapper unchanged into its validated
Vault/Object-derived location and proves its bound length and checksum. Compact authority is then
activated atomically. Failure removes prepared wrappers; successful activation makes them
authoritative and excludes them from cleanup.

# Future Extensions

Future storage capabilities may include:

- content-defined chunking
- cross-vault deduplication (optional)
- erasure coding
- cold storage tiers
- peer-to-peer replication
- local network synchronization

These extensions should not require Bundle format changes.

---

# References

- `docs/architecture/08-synchronization.md`
- `docs/architecture/11-search.md`
