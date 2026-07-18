# Projection Engine

**Document:** `architecture/10-projection-engine.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/05-client-runtime.md
- architecture/08-synchronization.md
- architecture/09-event-model.md

---

# Purpose

The Projection Engine transforms authoritative Objects and Events into efficient local representations suitable for querying, rendering, and user interaction.

Authoritative Objects are authoritative.

Projections are disposable.

They may be rebuilt at any time.

---

# Philosophy

Archive Platform separates:

Authoritative Data

↓

Derived State

Authoritative data consists of immutable Objects whose Object Types are defined by their specifications, including:

- Event Log Segment Objects
- Bundle Objects
- Wrapped Key Objects
- Vault Metadata Objects

Everything else is derived.

---

# Projection Pipeline

```
Event

↓

Projection Engine

↓

Projection

↓

Local Storage
```

Each Projection independently consumes authoritative Objects and Events.

---

# Projection Types

The runtime may maintain multiple Projections simultaneously.

Examples:

Archive Projection

Library Collection Projection

Folder Projection

Timeline Projection

Statistics Projection

Search Projection

AI Projection

Plugin Projection

Each Projection has independent lifecycle management.

The Library Collection Projection derives assigned and effective Collection membership, merge redirects, Active/Deleted membership, known URLs, and tail selection from immutable Events. Its item rows and Collection-state Materialization are encrypted and disposable. Rebuilding from the same Event order MUST reproduce equivalent Collection topology.

---

# Projection Lifecycle

```
Create Projection

↓

Replay Event Log

↓

Projection Built

↓

Receive Incremental Events

↓

Projection Updated
```

---

# Projection Interface

Every Projection implements:

Initialize

Replay(Event)

Checkpoint

Compact

Rebuild

Shutdown

The Projection Engine invokes these methods.

---

# Archive Projection

Responsibilities:

- archive list
- archive hierarchy
- archive metadata
- archive visibility

This Projection powers the primary user interface.

---

# Folder Projection

Responsibilities:

- folder hierarchy
- archive membership
- folder ordering

---

# Timeline Projection

Responsibilities:

- chronological views
- activity history
- capture history

---

# Statistics Projection

Responsibilities:

- storage usage
- archive counts
- tag counts
- capture rates

---

# Search Projection

Responsibilities:

- inverted Materializations
- ranking metadata
- tokenization
- semantic Materializations

Search implementation is described separately.

---

# AI Projection

Responsibilities:

- embedding references
- model metadata
- AI artifact Materializations

AI processing is described separately.

---

# Projection Isolation

Projections must not depend upon each other.

For example:

Archive Projection

must never query

Search Projection

Instead, both consume identical Events.

---

# Local Persistence

Each Projection chooses its own persistence.

Examples:

SQLite

IndexedDB

OPFS

Memory

Future implementations remain possible.

The Projection Engine remains storage-agnostic.

---

# Replay

Projection rebuilding occurs through replay.

```
Read Event Log

↓

Replay Every Event

↓

Projection Ready
```

Replay must be deterministic.

---

# Checkpoints

Large Event Logs may periodically record Projection checkpoints.

A checkpoint stores only derived state.

If unavailable:

Replay from Event 1.

Checkpoints are optional optimizations.

---

# Rebuild

A Projection may be discarded at any time.

```
Delete Projection

↓

Replay Events

↓

Projection Restored
```

Rebuilding never affects authoritative data.

---

# Event Ordering

Events arrive sequentially.

Projection application must preserve Event ordering.

Concurrent projection execution is allowed provided ordering within a Projection is maintained.

---

# Versioning

Every Projection has:

Projection Version

Changing internal storage requires incrementing Projection Version.

Older Projections should rebuild automatically.

---

# Failure Recovery

If a Projection fails:

Mark invalid.

Discard.

Replay Event Log.

Resume operation.

Projection corruption should never require server interaction.

---

# Plugin Projections

Plugins may register custom Projections.

```
Plugin

↓

Projection

↓

Replay Events

↓

Local View
```

Plugins never modify authoritative data.

---

# Performance

Projections should support:

incremental updates

batch replay

parallel rebuilding

background rebuilding

lazy initialization

---

# Design Decisions

## Why Projections?

Projections isolate query performance from synchronization.

---

## Why Replay?

Replay guarantees deterministic reconstruction.

---

## Why Disposable?

Derived data should never require backup.

---

## Why Independent Projections?

Isolation minimizes coupling and simplifies future extensions.

---

# Future Extensions

Future Projection types may include:

Knowledge Graph

Citation Graph

Document Similarity

Duplicate Detection

Reading History

Custom Plugin Views

These require no protocol changes.

---

# References

- `docs/architecture/11-search.md`
- `docs/architecture/12-processing-pipeline.md`
