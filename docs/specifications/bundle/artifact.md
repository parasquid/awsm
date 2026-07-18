# Artifact Specification

**Document:** `specifications/bundle/artifact.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- bundle.md
- manifest.md

---

# 1. Purpose

Artifacts are the immutable payloads contained within a Bundle.

Each Artifact represents one preserved or derived piece of information.

Artifacts are individually addressable.

Artifacts never change after Bundle creation.

---

# 2. Design Goals

Artifacts MUST provide:

- immutability
- independent validation
- explicit semantics
- format neutrality
- forward compatibility

---

# 3. Artifact Properties

Every Artifact MUST have:

- Artifact Identifier
- Kind
- Role
- MIME Type
- Byte Length
- Checksum
- Version

Optional properties MAY include:

- Original Filename
- Character Encoding
- Language
- Compression Information

---

# 4. Artifact Identifier

Artifact Identifiers MUST be unique within a Bundle.

Artifact Identifiers SHOULD remain stable for the lifetime of the Bundle.

Example:

A000001

---

# 5. Kind

Kind describes the nature of the Artifact.

Initial standard Kinds include:

CAPTURE

IMAGE

TEXT

DOCUMENT

METADATA

DERIVED

USER

Future Kinds MAY be introduced.

Readers MUST ignore unknown Kinds.

---

# 6. Role

Role describes the Artifact's purpose.

Examples:

PRIMARY

SCREENSHOT_FULL

SCREENSHOT_VISIBLE

OCR

THUMBNAIL

SUMMARY_AI

NOTE

FAVICON

MANIFEST_METADATA

Future Roles MAY be introduced.

---

# 7. MIME Type

Artifacts SHALL declare their MIME type.

Examples:

multipart/related

image/png

text/plain

application/pdf

application/json

---

# 8. Payload

The payload contains the Artifact's bytes.

The Bundle Specification does not define payload encoding.

Payload interpretation depends on MIME Type.

---

# 9. Compression

Compression is optional.

If applied, compression metadata MUST be recorded.

---

# 10. Encryption

The Artifact Specification describes plaintext representation only.

Encryption is defined by the Cryptography Specification.

---

# 11. Integrity

Every Artifact MUST include a checksum.

Implementations MUST validate checksums before use.

---

# 12. Relationships

Artifacts are independent.

Relationships between Artifacts are described by the Manifest.

Examples:

OCR belongs to PRIMARY.

Thumbnail derived from SCREENSHOT_FULL.

AI Summary derived from OCR.

Relationships SHALL NOT be inferred from filenames.

---

# 13. Standard Artifact Kinds

The following Kinds are reserved:

CAPTURE

IMAGE

TEXT

DOCUMENT

METADATA

DERIVED

USER

Implementations MAY define additional Kinds.

---

# 14. Standard Roles

Initial standard Roles include:

PRIMARY

SCREENSHOT_FULL

SCREENSHOT_VISIBLE

OCR

TEXT_EXTRACTED

THUMBNAIL

METADATA_CAPTURE

NOTE

ATTACHMENT_USER

SUMMARY_AI

EMBEDDING_AI

FAVICON

Roles SHOULD remain stable across Bundle versions.

---

# 15. Unknown Artifacts

Readers MUST preserve unknown Artifact Kinds and Roles.

Unsupported Artifacts MUST NOT invalidate the Bundle.

---

# 16. Validation

An Artifact is valid if:

✓ Identifier exists

✓ Kind exists

✓ Role exists

✓ MIME Type valid

✓ Byte Length correct

✓ Checksum matches

---

# 17. Invariants

Artifacts are immutable.

Artifact Identifiers are unique.

Payloads are opaque.

Artifacts are never modified in place.

Derived Artifacts never replace original Artifacts.

---

# 18. Future Compatibility

Future Bundle versions MAY introduce:

- new Kinds
- new Roles
- new MIME Types

Older readers SHOULD preserve unsupported Artifacts.

---

# References

bundle.md

manifest.md

crypto/crypto.md
