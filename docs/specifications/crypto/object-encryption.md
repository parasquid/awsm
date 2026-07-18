# Object Encryption Specification

**Document:** `specifications/crypto/object-encryption.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- crypto.md
- bundle/bundle.md
- event/event-format.md

---

# 1. Purpose

This specification defines the canonical encrypted representation of all persisted objects.

All encrypted objects SHALL use a common envelope format.

---

# 2. Design Goals

The encrypted object format MUST provide:

- confidentiality
- integrity
- algorithm agility
- deterministic parsing
- canonical format validation

---

# 3. Encrypted Object Layout

Conceptually:

```

Encrypted Object

├── Header
├── Nonce
├── Ciphertext
└── Authentication Tag

```

The Header is plaintext.

All remaining fields are protected by authenticated encryption.

---

# 4. Header

The Header SHALL contain:

- Format Version
- Object Type
- Encryption Algorithm Identifier
- Object Identifier

Optional fields MAY include:

- Compression Algorithm Identifier
- Payload Length

The Header MUST NOT contain user content.

---

# 5. Payload

The Payload contains the serialized plaintext object.

Examples include:

- Bundle
- Event Segment
- Projection Snapshot
- Wrapped Key

Payload serialization is defined by the relevant specification.

---

# 6. Compression

Compression SHALL occur before encryption.

Compression metadata SHALL be recorded in the Header.

---

# 7. Encryption

Encryption SHALL use:

- XChaCha20-Poly1305

The complete Payload SHALL be encrypted.

---

# 8. Associated Data

The Header SHALL be supplied as Additional Authenticated Data (AAD).

Any modification of the Header SHALL invalidate authentication.

---

# 9. Nonce

Every encrypted object SHALL contain a unique nonce.

Nonce reuse with the same key is prohibited.

---

# 10. Integrity

Integrity SHALL be provided by the authenticated encryption algorithm.

Separate integrity mechanisms are optional.

---

# 11. Decryption

Decryption SHALL verify authentication before exposing plaintext.

Authentication failure MUST abort processing.

---

# 12. Unknown Versions

Readers SHALL reject unsupported format versions.

---

# 13. Canonical Encryption Format

Exactly one encryption algorithm defined by this specification is canonical before the first release.

Objects SHALL indicate that encryption format explicitly. Alternate algorithm readers are not implemented.

---

# 14. Invariants

Every encrypted object has one envelope.

Headers are plaintext.

Payloads are encrypted.

Authentication precedes decryption.

---

# References

crypto.md

bundle/bundle.md

event/event-format.md
