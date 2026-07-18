# Coordination Protocol

**Document:** `architecture/08-synchronization.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/02-domain-model.md
- architecture/05-client-runtime.md
- architecture/06-bundle-format.md
- architecture/07-content-storage.md

---

# Purpose

This document defines how trusted clients synchronize Vaults through the Coordination Server.

The protocol guarantees eventual consistency while preserving the platform's zero-knowledge architecture.

The server coordinates synchronization but does not interpret archive contents.

---

# Design Goals

The synchronization protocol must provide:

- offline-first operation
- resumable transfers
- eventual consistency
- immutable history
- minimal server state
- horizontal scalability
- zero-knowledge operation

---

# Architectural Philosophy

Coordination is driven entirely by clients.

The server never determines:

- which Bundles exist
- which Archive is newer
- conflict resolution
- merge strategy

The server only stores:

- encrypted Blocks
- event metadata
- replication state

---

# Coordination Model

The protocol consists of two independent flows.

```
Content Flow

Blocks

↓

Object Storage


Control Flow

Events

↓

Coordination Server
```

These flows intentionally remain separate.

---

# Event Log

Every Vault has an append-only Event Log.

Examples:

Create Archive

Register Bundle

Rename Archive

Move Folder

Delete Archive

Add Note

Rotate Vault Root Key

Events are immutable.

Events are never modified.

---

# Event Structure

Every event contains:

- Event ID
- Vault ID
- Event Type
- Timestamp
- Author Device
- Dependencies
- Encrypted Payload
- Signature

The server cannot interpret the encrypted payload.

---

# Event Ordering

Events are ordered within a Vault.

Ordering guarantees deterministic replay.

Clients process Events sequentially.

---

# Coordination Sequence

Client startup:

```
Unlock Vault

↓

Read Local Event Cursor

↓

Ask Server

↓

Download Missing Events

↓

Replay Events

↓

Determine Missing Blocks

↓

Download Blocks

↓

Update Local State
```

---

# Upload Sequence

Creating a new Bundle:

```
Capture

↓

Register Bundle

↓

Encrypt Bundle

↓

Split Into Blocks

↓

Upload Missing Blocks

↓

Commit Event
```

The Event is committed only after all referenced Blocks are durable.

---

# Download Sequence

```
Receive Event

↓

Identify Required Blocks

↓

Download Missing Blocks

↓

Verify

↓

Reconstruct Bundle

↓

Apply Event
```

---

# Event Replay

Clients reconstruct Vault state by replaying Events.

Example:

```
Create Archive

↓

Add Capture

↓

Rename Archive

↓

Add Note

↓

Move Folder
```

The current Vault state is derived, not stored.

---

# Conflict Resolution

The server never resolves conflicts.

Clients are responsible.

Preferred strategy:

Last-writer-wins for mutable metadata.

Immutable Bundles never conflict.

Future document:

Conflict Resolution Strategy.

---

# Bundle Coordination

Bundles are immutable.

Coordination never updates Bundles.

Coordination only introduces new Bundles.

---

# Block Coordination

Before uploading:

Client asks:

```
Which Blocks do you already possess?
```

Missing Blocks are uploaded.

Existing Blocks are skipped.

---

# Commit

Commit is atomic.

Server verifies:

- every referenced Block exists
- Event signature valid
- Vault permissions valid

If successful:

Append Event.

Notify other devices.

---

# Notifications

Notification payloads contain only:

- Vault ID
- Latest Event Sequence

Clients decide what to fetch.

---

# Recovery

If synchronization stops:

Resume from latest Event Cursor.

No upload session exists.

No temporary synchronization state is required.

---

# Device Join

New Device:

```
Authorize Device

↓

Receive Vault Root Key

↓

Download Event Log

↓

Download Blocks

↓

Reconstruct Vault
```

The server performs no reconstruction.

---

# Device Rebuild

A rebuilt device performs exactly the same process.

The Event Log is authoritative.

---

# Event Cursor

Every device maintains:

- Last Applied Event
- Last Uploaded Event

The cursor enables resumable synchronization.

---

# Failure Handling

Interrupted upload:

Retry missing Blocks.

Interrupted download:

Resume.

Duplicate upload:

Ignored.

Duplicate Event:

Ignored.

Missing Block:

Retry.

---

# Garbage Collection

Deleting an Archive produces an Event.

Blocks remain until no Bundle references them.

Physical deletion occurs asynchronously.

Synchronization fences Vault Generations. Once Vacuum advances the active generation, a stale predecessor cannot re-upload omitted history; unpublished stale work requires explicit recovery.

---

# Server Responsibilities

The Coordination Server:

- authenticates devices
- stores Events
- stores Block references
- stores synchronization cursors
- notifies devices

The server never reconstructs Vault state.

---

# Client Responsibilities

The Client Runtime:

- creates Events
- signs Events
- uploads Blocks
- downloads Blocks
- replays Events
- resolves conflicts
- rebuilds local state

Coordination intelligence resides entirely in the client.

---

# Eventual Consistency

Given:

- reliable retries
- authenticated devices
- durable storage

all trusted clients observing the same Event Log will converge to identical Vault state.

---

# Design Decisions

## Why Events?

Events preserve history and simplify synchronization.

---

## Why Separate Events and Blocks?

Metadata changes should not require Bundle downloads.

Content changes should not require metadata duplication.

---

## Why Replay?

Replay enables deterministic reconstruction.

---

## Why Client-Owned Sync?

The server remains stateless regarding Vault semantics, enabling simple scaling and preserving zero knowledge.

---

# Future Extensions

Future protocol versions may add:

- peer-to-peer synchronization
- LAN discovery
- streaming Bundles
- partial Vault replication
- selective synchronization
- background prioritization

These extensions should not require changes to the Event model.

---

# References

- `docs/architecture/09-event-model.md`
- `docs/architecture/11-search.md`
- `docs/architecture/14-trust-and-device-management.md`
