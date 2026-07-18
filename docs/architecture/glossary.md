# Architecture Glossary

**Document:** `docs/architecture/glossary.md`

**Version:** 1.0

**Status:** Normative

---

# 1. Purpose

This document defines the canonical terminology used throughout the Archive Platform specifications.

All specifications SHALL use these definitions consistently.

Where another specification conflicts with this glossary, this glossary is authoritative.

---

# 2. Design Principles

Architectural terms SHALL have exactly one meaning.

A concept SHALL have one preferred name.

Synonyms SHOULD be avoided.

Implementation-specific terminology SHALL NOT replace architectural terminology.

---

# 3. Primary Concepts

## Vault

The complete authoritative archive belonging to a user or shared context.

A Vault contains authoritative data required to reconstruct the archive.

A Vault is the highest-level logical container.

---

## Vault Generation

An immutable encrypted reachability manifest identifying one authoritative history generation of a stable Vault.

## Vault History Rewrite

The verified construction of a successor Vault Generation without modifying existing Objects.

## Vault Vacuum

A destructive Runtime Job that replaces authoritative history with a verified successor Vault Generation and reclaims predecessor-only Objects belonging to Deleted Captures.

## Deleted

The logical Capture state in which content is absent from the main Library but remains retained, inspectable, and restorable until Vault Vacuum.

## Collection

A stable logical identity grouping Captures that the user considers versions of one page.

Collection membership and redirects are derived by replaying immutable Events. A Collection is not an authoritative Object or mutable container.

---

## Bundle

An immutable archival package representing one captured resource.

A Bundle contains one or more immutable Objects together with a Manifest describing the captured resource.

Bundles are authoritative.

Bundles are never modified after creation.

---

## Object

The smallest authoritative immutable storage unit.

Objects are identified by Object Identifier.

Objects are opaque outside their defining specification.

Objects remain immutable.

---

## Object Identifier

A globally unique identifier referencing an immutable Object.

Object Identifiers remain stable for the lifetime of an Object.

---

## Manifest

Structured metadata describing another logical entity.

Examples include:

- Bundle Manifest
- Export Manifest
- Snapshot Manifest

A Manifest describes but does not replace authoritative Objects.

---

## Runtime

The platform-independent application responsible for executing business logic.

The Runtime coordinates Services.

The Runtime is independent of browsers and operating systems.

---

## Host

A platform-specific integration layer.

Examples include:

- Chrome Extension
- Firefox Extension
- Safari Extension
- Electron
- Native Desktop

Hosts provide platform capabilities.

Hosts do not implement business logic.

---

## Service

A Runtime component responsible for one bounded capability.

Examples include:

- Storage Service
- Capture Service
- Search Service
- Synchronization Service
- AI Service

Services communicate through Runtime Events and Commands.

---

## Projection

A rebuildable derived representation of authoritative data.

Projections are never authoritative.

Examples include:

- Search
- Timeline
- Folder hierarchy
- Tag counts
- Recent documents

---

## Materialization

A concrete implementation of a Projection optimized for a particular purpose.

Examples include:

- inverted index
- SQLite FTS table
- vector index
- B-tree

Materializations are implementation details.

---

# 4. Storage Concepts

## Storage Service

The Runtime Service responsible for object persistence.

The Storage Service exposes logical storage semantics.

---

## Storage Driver

A platform-specific adapter implementing Storage Service persistence.

Examples include:

- OPFS
- SQLite
- IndexedDB
- Local Filesystem

Drivers hide persistence implementation details.

---

## Persistence Backend

The underlying storage technology used by a Storage Driver.

Examples include:

- OPFS
- SQLite
- IndexedDB

Persistence Backends are implementation details.

---

# 5. Capture Concepts

## Capture Request

A request to archive a resource.

---

## Capture Job

The Runtime Job responsible for executing a Capture Request.

---

## Capture Result

The successful output of a Capture Job prior to Bundle creation.

---

## Capture Profile

A versioned configuration describing which representations and artifacts shall be captured.

---

# 6. Synchronization Concepts

## Replica

A complete local or remote copy of a Vault.

---

## Coordination Server

A server responsible for coordinating replica synchronization.

Coordination Servers are not authoritative.

Coordination Servers do not require plaintext Vault data.

---

## Synchronization Session

A communication session between replicas.

---

## Synchronization Cycle

One reconciliation pass performed during a Session.

---

# 7. AI Concepts

## AI Provider

A component capable of executing AI Capabilities.

Providers may be local or remote.

---

## Capability

A logical AI function.

Examples include:

- OCR
- Summarization
- Embedding Generation
- Translation

Capabilities are requested independently of models.

---

## Model

A concrete implementation used by an AI Provider.

Models are implementation details.

---

## Derived Artifact

An immutable Object generated from authoritative data.

Examples include:

- Summary
- OCR text
- Embeddings
- Keywords
- Language metadata

Derived Artifacts remain immutable.

---

# 8. Job Concepts

## Job

A durable unit of long-running Runtime work.

---

## Scheduler

The Runtime component responsible for scheduling Jobs.

---

## Worker

A Runtime component responsible for executing Jobs.

---

# 9. Backup Concepts

## Snapshot

An immutable logical view of a Vault at a point in time.

---

## Backup

A durable recovery copy derived from a Snapshot.

---

## Recovery Plan

A validated execution plan describing how Restore will reconstruct a Vault.

---

# 10. Event Concepts

## Runtime Event

A local event exchanged between Runtime Services.

Runtime Events are not synchronized.

---

## Vault Event

An authoritative event synchronized between Vault replicas.

Vault Events become part of the Event Log.

---

# 11. Authoritative vs Derived

## Authoritative Data

Data required to reconstruct a Vault.

Examples:

- Bundles
- Objects
- Wrapped Keys
- Vault Events
- Vault Metadata

---

## Derived Data

Data that can be rebuilt from authoritative data.

Examples:

- Search projections
- AI projections
- Tag counts
- Timeline
- Folder hierarchy
- Recent documents

---

# 12. Implementation Concepts

The following terms are implementation-specific and SHALL NOT be used as architectural abstractions.

Examples:

- OPFS
- IndexedDB
- Chrome
- Firefox
- SQLite
- Ollama
- OpenAI
- Gemini

These belong only in implementation-specific specifications.

---

# 13. Reserved Terms

The following terms have specific architectural meanings and SHALL NOT be repurposed:

- Vault
- Bundle
- Object
- Projection
- Runtime
- Host
- Service
- Driver
- Snapshot
- Recovery Plan
- Capability
- Provider
- Manifest
- Job
- Vault Generation
- Vault Vacuum

---

# References

All specifications.
