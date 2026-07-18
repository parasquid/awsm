# Event Serialization Format Specification

**Document:** `specifications/event/event-format.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- event.md
- crypto/crypto.md

---

# 1. Purpose

This specification defines the canonical serialized representation of Events.

Serialization is independent of transport.

The same serialized Event may be:

- stored locally
- synchronized
- digitally signed
- encrypted
- replayed

without modification.

---

# 2. Design Goals

The serialization format MUST provide:

- deterministic encoding
- compact representation
- binary safety
- canonical format validation
- cryptographic stability

---

# 3. Canonical Encoding

The canonical Event encoding SHALL be CBOR.

Alternative representations such as JSON MAY be provided for debugging or diagnostics.

Only the canonical representation participates in:

- hashing
- signatures
- integrity verification

---

# 4. Event Layout

Conceptually:

```
Event

Header

Payload

Integrity
```

Serialization order is normative.

---

# 5. Header Encoding

The Header SHALL encode:

- Event ID
- Event Type
- Category
- Version
- Timestamp
- Device ID
- Vault ID

Field ordering SHALL be deterministic.

---

# 6. Payload Encoding

Payload fields SHALL follow the schema associated with the Event Type.

Unknown fields MUST invalidate decoding.

---

# 7. Integrity Encoding

Integrity information SHALL contain:

- checksum
- signature (optional)
- cryptographic version

Algorithms are defined elsewhere.

---

# 8. Canonical Ordering

Maps SHALL be encoded deterministically.

Equivalent Events MUST serialize identically.

---

# 9. Unknown Fields

Readers SHALL reject unknown fields.

Writers SHALL emit only fields defined by the canonical Event schema.

---

# 10. Binary Values

Binary values SHALL be represented using native binary encoding.

Base64 encoding is not part of the canonical representation.

---

# 11. Time Representation

Timestamps SHALL use a canonical representation defined by the Protocol Specification.

Implementations MUST NOT depend on locale.

---

# 12. Validation

Serialization is valid if:

✓ canonical encoding

✓ required fields present

✓ deterministic ordering

✓ integrity verifies

---

# 13. Stored Event Dependency Metadata

Local encrypted Event storage SHALL pair the canonical encrypted Event envelope with:

- canonical storage-format version;
- Vault ID;
- Event ID;
- canonical ordering timestamp; and
- `referencedObjectIds`, encoded as a lexically sorted list of unique Object IDs.

`referencedObjectIds` declares every immutable Object dependency required to authenticate and replay
the Event. An Event with no Object dependency, including `VaultCreated` and `VaultRenamed`, uses an
empty list. The stored Vault ID, Event ID, and ordering timestamp MUST equal the authenticated values
inside the decrypted Event. A mismatched identity, missing dependency, duplicate dependency,
unsorted list, unknown field, or cross-Vault reference invalidates the stored Event.

Example conceptual wrapper:

```text
version: 1
vaultId: 018f…
eventId: 0190…
referencedObjectIds: []
orderingTimestamp: 2026-07-18T12:00:00.000Z
envelopeBytes: <canonical encrypted Event envelope>
```

---

# 14. Invariants

Equivalent Events serialize identically.

Serialization is transport-independent.

Serialization is deterministic.

---

# References

event.md

protocol/protocol.md

crypto/crypto.md
