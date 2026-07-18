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
- forward compatibility
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

Unknown fields MUST be preserved.

Unknown fields MUST NOT invalidate decoding.

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

Readers SHALL preserve unknown fields.

Unknown fields SHALL survive serialization and deserialization.

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

# 13. Invariants

Equivalent Events serialize identically.

Serialization is transport-independent.

Serialization is deterministic.

---

# References

event.md

protocol/protocol.md

crypto/crypto.md
