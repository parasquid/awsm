# Import and Export Specification

**Document:** `specifications/portability/import-export.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This specification defines the canonical import and export format for Vaults.

The format is intended for:

- portability
- migration
- archival
- interoperability

Import and Export operate on complete Vaults or explicitly selected subsets.

---

# 2. Design Goals

The format MUST provide:

- complete fidelity
- deterministic structure
- versioning
- forward compatibility
- cryptographic integrity

---

# 3. Export Model

Export produces a portable Vault Package.

The package contains authoritative data only.

Rebuildable projections SHALL NOT be exported.

---

# 4. Package Layout

Example:

Vault Package

↓

Manifest

Vault Metadata

Bundles

Events

Wrapped Keys

Attachments

The physical serialization format is implementation-defined.

---

# 5. Manifest

The Manifest SHALL include:

- export format version
- creation timestamp
- originating Vault identifier
- object counts
- checksum information
- supported features

The Manifest SHALL NOT contain decrypted user content.

---

# 6. Exported Objects

Exports MAY include:

- Bundles
- Event Segments
- Wrapped Keys
- Vault Metadata
- User Configuration (optional)
- AI Artifacts (optional)

---

# 7. Excluded Objects

Exports SHALL NOT include:

- Search Projection Materializations
- Projections
- caches
- temporary files
- job queues
- runtime diagnostics

These SHALL be rebuilt after import.

---

# 8. Encryption

Exports MAY remain encrypted.

Optionally, exports MAY be re-encrypted using an export password.

No plaintext export is performed unless explicitly requested.

---

# 9. Integrity

Every exported Object SHALL retain integrity metadata.

The package SHALL include overall package verification data.

---

# 10. Import

Import SHALL execute as an Import Job through the Runtime Job Framework and verify:

- package version
- integrity
- cryptographic metadata
- object consistency

Verification SHALL complete before modifying the destination Vault.

---

# 11. Import Modes

Supported modes MAY include:

- Create New Vault
- Merge Into Existing Vault
- Read-Only Inspection

Merge semantics are defined separately.

---

# 12. Partial Export

Users MAY export subsets.

Examples:

- selected Bundles
- date ranges
- folders
- tags

Partial exports remain valid Vault Packages.

---

# 13. Compatibility

Readers SHALL ignore unknown optional sections.

Unsupported mandatory sections SHALL terminate import.

---

# 14. Recovery

Interrupted imports SHALL leave the destination Vault unchanged.

Imports SHALL execute atomically.

---

# 15. Invariants

Exports contain authoritative Objects and required public interchange metadata.

Imports preserve object identities.

Projections and Materializations are rebuilt.

Bundles remain immutable.

---

# References

- `docs/specifications/bundle/bundle.md`

- `docs/specifications/vault/vault.md`

- `docs/specifications/crypto/crypto.md`
