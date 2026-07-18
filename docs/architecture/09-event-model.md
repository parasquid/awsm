# Event Model

**Document:** `architecture/09-event-model.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/02-domain-model.md
- architecture/08-synchronization.md

---

# Purpose

This document defines the Event Model used throughout Archive Platform.

Events are the authoritative representation of all state changes within a Vault.

Bundles preserve immutable content.

Events preserve immutable history.

Together they define the complete state of a Vault.

---

# Philosophy

The platform follows an append-only architecture.

Mutable state is never synchronized.

Instead, clients synchronize immutable Events.

Local state is reconstructed by replaying those Events.

---

# Commands vs Events

A Command expresses intent.

An Event records something that has already happened.

```
RenameArchiveCommand

↓

Validation

↓

ArchiveRenamedEvent
```

Commands never leave the originating client.

Only Events synchronize.

---

# Event Lifecycle

```
User Action

↓

Command

↓

Validation

↓

Event

↓

Append Local Event Log

↓

Upload Event

↓

Other Devices

↓

Replay
```

Events are immutable.

---

# Event Properties

Every Event contains:

- Event ID
- Vault ID
- Event Type
- Device ID
- Timestamp
- Parent Event (optional)
- Event Version
- Encrypted Payload
- Signature

---

# Event Categories

## Archive Events

Create Archive

Rename Archive

Delete Archive

Restore Archive

---

## Bundle Events

Bundle Registered

Bundle Imported

Bundle Removed

`BundleRegistered` is the canonical first-slice Event name. It records that an immutable Bundle Object was accepted into Vault history. Host-level capture completion is operational state and does not introduce a separate synchronized `BundleCreated` Event.

---

## Folder Events

Folder Created

Folder Renamed

Folder Deleted

Bundle Moved

Bundle Removed From Folder

---

## Note Events

Note Created

Note Updated

Note Deleted

---

## Tag Events

Tag Added

Tag Removed

Tag Renamed

---

## Vault Events

Vault Created

Vault Renamed

Vault Shared

Vault Root Key Rotated

Vault Deleted

---

## Device Events

Device Added

Device Revoked

Device Trusted

Device Removed

---

## AI Events

Artifact Generated

Artifact Removed

Artifact Regenerated

---

# Event Payload

The Coordination Server treats the payload as opaque.

Only trusted clients interpret it.

Example:

```
ArchiveRenamedEvent

↓

Encrypted Payload

old name

new name
```

---

# Event Versioning

Every Event Type has its own schema version.

Older clients ignore unknown fields.

Unknown Event Types must be preserved.

---

# Event Ordering

Events are totally ordered within a Vault.

Replay order must be deterministic.

Clients should never reorder Events.

---

# Event Replay

The runtime rebuilds state entirely from replay.

```
Vault Created

↓

Archive Created

↓

Bundle Registered

↓

Tag Added

↓

Archive Renamed

↓

Note Added
```

The resulting state is deterministic.

---

# Materialized Views

The runtime maintains local projections.

Examples:

Archive List

Search Projection Materialization

Folder Tree

Tag Index

Timeline

These are caches.

They are never synchronized.

They may be rebuilt at any time.

---

# Event Validation

Before appending an Event:

- schema valid
- permissions valid
- signature valid
- dependencies satisfied

Invalid Events are rejected locally.

---

# Idempotency

Applying the same Event twice produces the same result as applying it once.

Clients must ignore duplicate Event IDs.

---

# Event Dependencies

Some Events depend upon earlier Events.

Example:

```
Archive Created

↓

Bundle Registered
```

Dependencies prevent impossible histories.

---

# Event Immutability

Events are never edited.

Corrections generate new Events.

Example:

```
Rename A

↓

Rename B
```

Never:

```
Edit Event
```

---

# Event Log

Every Vault owns exactly one append-only Event Log.

```
Vault

↓

Event Log

↓

Replay

↓

Materialized Views
```

The Event Log is authoritative.

---

# Design Decisions

## Why Commands?

Commands separate user intent from recorded history.

---

## Why Replay?

Replay enables migration, debugging, auditing, and deterministic reconstruction.

---

## Why Materialized Views?

Views optimize performance while remaining disposable.

---

## Why Immutable Events?

Immutable history simplifies synchronization and conflict resolution.

---

# Future Extensions

Future Event Types may support:

- comments
- annotations
- citations
- OCR improvements
- AI workflows
- plugins

Existing clients should safely ignore unknown Events.

---

# References

- `docs/architecture/10-projection-engine.md`
- `docs/architecture/11-search.md`
- `docs/architecture/12-processing-pipeline.md`
