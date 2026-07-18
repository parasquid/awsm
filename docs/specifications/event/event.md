# Event Specification

**Document:** `specifications/event/event.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This specification defines the canonical Event format used throughout Archive Platform.

Events are the immutable record of facts that have occurred within a Vault.

The Event Log is the authoritative history of Vault state.

Current state is derived exclusively by replaying Events.

---

# 2. Design Goals

Events MUST provide:

- immutability
- deterministic replay
- canonical format validation
- cryptographic integrity
- transport independence
- versioning

---

# 3. Non-Goals

Events do not define:

- UI state
- projections
- Search Projection Materializations
- caches
- synchronization protocol

Those are specified elsewhere.

---

# 4. Event Properties

Every Event MUST be:

- immutable
- uniquely identifiable
- versioned
- timestamped
- attributable to a trusted device

---

# 5. Event Structure

Conceptually every Event contains:

```
Event

├── Header
├── Payload
└── Integrity Information
```

The serialization format is specified separately.

---

# 6. Header

Every Event MUST contain:

- Event ID
- Event Type
- Event Version
- Vault ID
- Device ID
- Event Timestamp
- Protocol Version

Optional fields MAY include:

- Correlation ID
- Causation ID
- Extension ID

---

# 7. Payload

The Payload contains the Event-specific data.

The payload SHALL be interpreted according to Event Type.

Canonical pre-release Event decoders SHALL reject unknown payload fields.

---

# 8. Integrity

Every Event MUST provide integrity verification.

Integrity information includes:

- checksum
- signature (if applicable)
- cryptographic version

Algorithms are defined by the Cryptography Specification.

---

# 9. Event Ordering

Events are ordered within a Vault.

The ordering mechanism is defined by the Synchronization Protocol.

Readers MUST preserve Event ordering.

---

# 10. Event Domains

Standard domains include:

- Bundle
- Vault
- Trust
- Device
- User
- Extension

Additional domains MAY be introduced.

---

# 11. Standard Event Types

Examples include:

BundleRegistered

BundleRemoved

CapturesDeleted

CapturesRestored

CollectionsMerged

CapturesMoved

CollectionMergeReverted

TagAdded

TagRemoved

NoteAdded

NoteUpdated

FolderCreated

FolderRenamed

DeviceEnrolled

DeviceRevoked

VaultKeyRotated

VaultCreated

VaultRenamed

Future versions MAY introduce additional Event Types.

## 11.1 VaultCreated

`VaultCreated` version 1 records the accepted initial normalized name of one newly created Vault. Its payload contains the Vault ID, Device ID, canonical timestamp, protocol version, and name. It MUST be committed atomically with Vault creation and MUST be the first name Event in that Vault.

## 11.2 VaultRenamed

`VaultRenamed` version 1 records a new normalized name for an existing Vault. It contains the Vault ID, Device ID, canonical timestamp, protocol version, and name. Deterministic replay orders name Events by the Vault Event order; the last valid ordered Rename determines the current name.

Vault names are private plaintext and MUST be encrypted before persistence outside trusted Runtime memory or synchronization.

## 11.3 BundleRegistered

`BundleRegistered` version 1 SHALL contain the Bundle ID, Collection ID, Bundle Descriptor Object
ID, the sorted unique Artifact Object IDs, Capture timestamp, original URL, and typed Capture
warnings. Its referenced Object IDs SHALL equal exactly the descriptor Object ID plus every Artifact
Object ID in the descriptor. The descriptor's Bundle ID and metadata SHALL match the Event.

Warnings SHALL exactly explain absent best-effort Roles or the successful screenshot truncation
condition. Mandatory `PRIMARY` has no absence warning because its failure prevents registration.
Replay SHALL reject closure, metadata, Role, or warning mismatches.

---

# 12. Event Semantics

Events record facts.

Events MUST NOT express intent.

Examples:

Correct:

BundleRegistered

Incorrect:

RegisterBundle

Correct:

TagAdded

Incorrect:

AddTag

---

# 13. Unknown Events

Readers MUST reject unknown Event Types.

Unsupported Events MUST fail replay and prevent unsafe state changes.

---

# 14. Replay

Replay SHALL process Events sequentially.

Given the same Event sequence, replay MUST produce equivalent projections.

Replay MUST be deterministic.

---

# 15. Versioning

Every Event SHALL contain:

- Event Schema Version
- Payload Version

Future versions MAY introduce additional version identifiers.

---

# 16. Validation

An Event is valid if:

✓ Event ID exists

✓ Event Type exists

✓ Version present

✓ Payload valid

✓ Integrity verifies

Invalid Events MUST NOT be applied.

---

# 17. Relationships

Events MAY reference:

- Bundle IDs
- Artifact IDs
- Device IDs
- User IDs
- Previous Events

References SHALL use stable identifiers.

---

# 18. Event Size

Events SHOULD remain small.

Large binary content MUST reside in Artifact Objects.

Events reference Bundles rather than embedding them.

---

# 19. Idempotency

Applying the same Event multiple times MUST produce the same logical state.

---

# 20. Invariants

Events never change.

Events are append-only.

History is authoritative.

Replay is deterministic.

Unknown Events are rejected.

---

# 21. Unsupported Event Semantics

Event semantics outside this specification are unsupported, including:

- new Event Types
- new Domains
- new payload fields

Readers MUST reject unsupported Event Types and fields.

---

# References

commands.md

bundle/bundle.md

protocol/protocol.md

crypto/crypto.md
