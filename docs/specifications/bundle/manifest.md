# Bundle Manifest Specification

**Document:** `specifications/bundle/manifest.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- bundle.md
- artifact.md

---

# 1. Purpose

The Manifest is the authoritative description of a Bundle.

It identifies the Bundle, lists its Artifacts, records structural metadata, and provides sufficient information to validate and interpret the Bundle.

The Manifest does not contain preserved content.

---

# 2. Design Goals

The Manifest MUST provide:

- deterministic structure
- canonical format validation
- artifact discovery
- integrity verification
- version identification

---

# 3. Manifest Properties

A Manifest MUST:

- exist exactly once
- be immutable
- be versioned
- describe every Artifact in the Bundle

---

# 4. Manifest Layout

Conceptually, a Manifest consists of:

```
Manifest

├── Header
├── Bundle Information
├── Artifact Index
├── Processing History
└── Validation Information
```

The serialized representation is defined separately.

---

# 5. Header

The Header SHALL contain:

- Manifest Version
- Bundle Specification Version
- Bundle Identifier
- Manifest Identifier (optional)
- Creation Timestamp
- Creating Client Version
- Serialization Format Identifier

These fields identify the format and origin of the Manifest.

---

# 6. Bundle Information

The Bundle Information section SHALL include:

- Bundle Identifier
- Bundle Creation Time
- Capture Source Type
- Capture Adapter Version

Optional fields MAY include:

- Original URL
- Final URL after redirects
- Browser Name
- Browser Version
- Operating System

These fields describe the capture context rather than the archived content itself.

---

# 7. Artifact Index

The Artifact Index is a collection of Artifact References.

Each Artifact Reference MUST contain:

- Artifact Identifier
- Artifact Schema Version
- Kind
- Role
- MIME Type
- Byte Length
- Checksum
- Checksum Algorithm Identifier
- Canonical Bundle Path

Optional fields MAY include:

- Original Filename
- Character Encoding
- Language
- Compression Information

The Artifact Index MUST reference every Artifact exactly once.

---

# 8. Artifact Ordering

Artifact ordering has no semantic meaning.

Readers MUST identify Artifacts by Identifier and Role rather than position.

For canonical serialization, Artifact References SHALL be ordered by Artifact Identifier and ZIP entries SHALL be ordered lexicographically by complete path.

---

# 9. Processing History

The Manifest MAY contain an ordered list of processing records describing transformations applied after capture.

Examples:

- OCR generated
- Thumbnail generated
- AI summary generated

Processing records describe derived artifacts only.

The original capture is never modified.

---

# 10. Validation Information

The Manifest SHALL contain sufficient information to verify Bundle integrity.

Examples include:

- Bundle checksum
- Manifest checksum
- Cryptographic version
- Serialization version

The exact algorithms are defined by the Cryptography Specification.

---

# 11. Unknown Fields

Readers MUST reject unknown fields.

Readers MUST serialize only fields defined by this specification.

---

# 12. Versioning

The Manifest SHALL contain explicit version identifiers for:

- Manifest schema
- Bundle specification
- Serialization format

The initial Manifest encoding SHALL be canonical CBOR with identifier `cbor:canonical:v1`.

The initial containing Bundle serialization SHALL use identifier `bundle:zip:v1`.

---

# 13. Invariants

The Manifest MUST describe every Artifact.

Every Artifact MUST appear exactly once in the Artifact Index.

The Manifest MUST NOT embed Artifact payloads.

The Manifest MUST remain immutable after Bundle creation.

---

# 14. Error Conditions

A Manifest is invalid if:

- required fields are missing
- duplicate Artifact Identifiers exist
- an Artifact Reference cannot be resolved
- version identifiers are absent
- checksums do not validate

Implementations MUST reject invalid Manifests.

---

# 15. Unsupported Manifest Semantics

Manifest semantics outside this specification are unsupported, including:

- additional Artifact roles
- additional processing records
- additional validation metadata

Readers MUST reject unknown sections.

---

# References

- bundle.md
- artifact.md
- crypto/crypto.md
