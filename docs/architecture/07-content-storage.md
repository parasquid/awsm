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

# Bundle Store

The Bundle Store maps Bundles to Blocks.

Example:

```text
Bundle A

↓

Block 1

Block 2

Block 3
```

The Bundle Store maintains ordering information required for reconstruction.

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

```text
Client

↓

Local Object Store

Server

↓

Remote Object Store
```

Synchronization may copy Objects or derived Blocks between the two according to protocol capabilities.

---

# Upload Process

```text
Bundle

↓

Encrypted Bundle

↓

Blocks

↓

Determine Missing Blocks

↓

Upload Missing Blocks

↓

Commit Bundle
```

The commit step occurs only after all Blocks are durable.

---

# Download Process

```text
Bundle Requested

↓

Retrieve Block List

↓

Download Blocks

↓

Reassemble

↓

Decrypt

↓

Deserialize
```

---

# Integrity

Every Block includes a checksum.

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
