# Bundle Specification

**Document:** `specifications/bundle/bundle.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This specification defines the canonical on-disk representation of an archived capture.

A Bundle is the immutable unit of preservation.

Bundles are portable.

Bundles are self-describing.

Bundles are content-addressable.

---

# 2. Goals

The Bundle format must provide:

- faithful preservation
- immutability
- forward compatibility
- efficient validation
- deterministic serialization
- offline portability
- cryptographic verification

---

# 3. Non-Goals

Bundles do not define:

- synchronization
- search
- authentication
- authorization
- AI processing
- projection state

These are specified elsewhere.

---

# 4. Bundle Properties

A Bundle SHALL be:

- immutable
- self-contained
- versioned
- independently verifiable

---

# 5. Bundle Identifier

Every Bundle has a globally unique identifier.

```
BundleID
```

The BundleID is assigned when the Bundle is created.

Once assigned it MUST NOT change.

The identifier is distinct from any content hash.

---

# 6. Bundle Structure

A Bundle consists of:

```
Bundle

├── Manifest
├── Artifacts
└── Metadata
```

No additional top-level objects are permitted.

---

# 7. Manifest

Exactly one Manifest SHALL exist.

The Manifest describes the Bundle.

The Manifest does not duplicate Artifact contents.

---

# 8. Artifacts

Artifacts contain preserved content.

Examples include:

- page.mhtml
- screenshot.webp
- favicon.ico
- extracted-text.txt
- ai-summary.md

Artifacts are immutable.

Artifacts are individually identifiable.

---

# 9. Metadata

Metadata describes the Bundle itself.

Examples:

- capture timestamp
- source URL
- Bundle version
- creator version

Metadata SHALL NOT duplicate Artifact data unless explicitly required.

---

# 10. Artifact Requirements

Every Artifact MUST include:

- ArtifactID
- MIME type
- byte length
- checksum

Optional fields:

- filename
- language
- encoding
- role

---

# 11. Roles

Artifacts are identified by role rather than filename.

Initial standard Roles:

PRIMARY

SCREENSHOT_FULL

SCREENSHOT_VISIBLE

TEXT_EXTRACTED

THUMBNAIL

FAVICON

SUMMARY_AI

NOTE

Roles are normative.

Filenames are informative.

---

# 12. MIME Types

Artifacts SHALL declare MIME types.

Examples:

text/html

multipart/related

image/png

image/jpeg

image/webp

text/plain

application/pdf

---

# 13. Checksums

Every Artifact SHALL include a checksum.

Checksums verify integrity.

The checksum algorithm is defined by the Cryptography Specification.

---

# 14. Compression

Compression is optional.

Compression metadata SHALL be recorded in the Manifest.

The initial ZIP serialization uses a fixed DEFLATE configuration identified by the Bundle serialization version.

---

# 15. Encryption

Bundles are serialized before encryption.

The Bundle Specification describes plaintext structure only.

Encrypted representation is defined separately.

---

# 16. Serialization

Serialization SHALL be deterministic.

Equivalent Bundles MUST produce equivalent serialized representations.

The initial serialization SHALL be a ZIP archive with serialization identifier:

```text
bundle:zip:v1
```

The canonical layout SHALL be:

```text
manifest.cbor
metadata.cbor
artifacts/<artifact-path>
```

ZIP entries SHALL:

- use UTF-8 paths
- be ordered lexicographically by complete path
- omit directory entries
- use the fixed timestamp 1980-01-01 00:00:00
- use the compression settings declared by the serialization version
- omit comments and platform-specific or nondeterministic extra fields

The Manifest and Bundle metadata SHALL use canonical CBOR with serialization identifier:

```text
cbor:canonical:v1
```

User-visible Bundle metadata SHALL remain inside the Bundle serialization so that Object encryption protects it.

The first implementation Capture Profile, `ChromeWebPage-v1`, SHALL use:

- `artifacts/primary.mhtml` for the required `PRIMARY` Artifact
- `artifacts/screenshot-full.webp` for the optional lossy `SCREENSHOT_FULL` Artifact

Filenames remain informative. Readers SHALL resolve Artifacts using Manifest identifiers and Roles.

---

# 17. Unknown Fields

Readers SHALL ignore unknown fields.

Readers SHALL preserve unknown fields when rewriting Bundles.

---

# 18. Versioning

Every Bundle SHALL contain:

Bundle Version

Manifest Version

Artifact Schema Version

---

# 19. Validation

A valid Bundle MUST satisfy:

✓ Manifest exists

✓ Artifact IDs unique

✓ Checksums valid

✓ Version present

✓ Required metadata present

---

# 20. Future Compatibility

Future Bundle versions MAY introduce:

- new Artifact roles
- new metadata
- new compression methods

Readers SHOULD preserve unsupported data whenever possible.

---

# 21. Invariants

Bundles never change.

Artifacts never change.

Manifest describes rather than owns Artifacts.

Roles identify semantics.

Checksums verify integrity.

---

# References

manifest.md

artifact.md

crypto.md
