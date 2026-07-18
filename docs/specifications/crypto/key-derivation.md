# Key Derivation Specification

**Document:** `docs/specifications/crypto/key-derivation.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- crypto.md
- object-encryption.md
- vault/vault.md

---

# 1. Purpose

This specification defines how Archive Platform derives cryptographic keys from Vault-level secrets.

Key derivation provides domain separation, algorithm agility, and deterministic reconstruction of subordinate keys on trusted devices.

---

# 2. Design Goals

Key derivation MUST provide:

- domain separation
- deterministic output for identical inputs
- algorithm versioning
- Vault isolation
- support for key rotation
- zero-knowledge server operation

---

# 3. Primitive

The initial key derivation primitive SHALL be:

```text
HKDF-SHA256
```

Future derivation algorithms MAY be introduced with new algorithm identifiers.

---

# 4. Key Hierarchy

Conceptually:

```text
Master Secret

↓

Vault Root Key

├── Bundle Key Domain
├── Event Key Domain
├── Artifact Key Domain
├── Metadata Key Domain
└── Wrapping Key Domain
```

The Vault Root Key is the root secret for one Vault only.

---

# 5. Inputs

Every derivation SHALL include:

- parent key material
- algorithm identifier
- domain label
- Vault ID
- key version
- context identifier where applicable

Context identifiers MAY include Bundle ID, Event ID, Artifact ID, Device ID, or Object Identifier depending on the derived key's purpose.

---

# 6. Domain Labels

Initial domain labels include:

```text
vault:bundle:v1
vault:event:v1
vault:artifact:v1
vault:metadata:v1
vault:projection:v1
vault:device-wrap:v1
vault:object:v1
```

Domain labels MUST NOT be reused for different semantics.

---

# 7. Bundle Keys

Bundle keys protect serialized Bundle contents.

The derivation context SHALL include:

- Vault ID
- Bundle ID
- Bundle key version

The initial implementation SHALL derive Bundle keys with HKDF-SHA256. It SHALL NOT generate or persist a separate random wrapped Bundle key.

---

# 8. Event Keys

Event keys protect Event payloads.

The derivation context SHALL include:

- Vault ID
- Event domain or Event type
- Event key version

Event headers required for ordering and routing MAY remain outside the encrypted payload.

The initial implementation SHALL derive one Event key per Event ID.

---

# 9. Artifact Keys

Artifact keys protect Artifact payloads when Artifacts are encrypted independently from their containing Bundle or storage Object.

The derivation context SHALL include:

- Vault ID
- Artifact ID
- Artifact key version

---

# 10. Metadata Keys

Metadata keys protect synchronized user-visible metadata.

The derivation context SHALL include:

- Vault ID
- metadata domain
- metadata key version

Operational metadata required for coordination is not protected by this key unless explicitly specified.

---

# 11. Projection Keys

Projection keys protect local derived state such as encrypted Search Projection Materializations and projection snapshots.

The derivation context SHALL include:

- Vault ID
- projection type
- projection key version

Projection keys protect rebuildable local state and SHALL NOT become authoritative Vault history.

The initial implementation SHALL derive one Projection-row key using the projection type and referenced Bundle ID as context.

---

# 12. Device Wrapping Keys

Device wrapping keys protect Vault Root Keys or subordinate key material for trusted devices.

The derivation or wrapping context SHALL include:

- Vault ID
- Device ID
- wrapping key version

The Coordination Server stores wrapped keys only.

---

# 13. Rotation

Key rotation increments the relevant key version.

Old versions MUST remain usable for decrypting existing data until migration or retention policy removes that data.

Rotation of one domain SHOULD NOT require immediate re-encryption of unrelated domains.

---

# 14. Algorithm Agility

Derived keys SHALL record enough metadata to identify:

- derivation algorithm
- domain label
- key version
- parent key version

Unsupported derivation algorithms MUST cause decryption or derivation to fail safely.

---

# 15. Server Constraints

The Coordination Server MUST NOT:

- derive keys
- receive parent key material
- receive unwrapped Vault Root Keys
- influence derivation output

All derivation occurs inside trusted clients.

---

# 16. Invariants

- Derived keys are domain-separated.
- Key derivation is deterministic for identical inputs.
- Key versions are explicit.
- Vault Root Keys never cross the trust boundary unwrapped.
- The server cannot derive or unwrap Vault contents.

---

# References

- crypto.md
- object-encryption.md
- `docs/architecture/18-cryptography.md`
