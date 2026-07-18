# Bundle Format Specification

**Document:** `architecture/06-bundle-format.md`

**Status:** Draft

**Version:** 1.0

**Owner:** Engineering

**Depends On:**

* architecture/02-domain-model.md
* architecture/04-security-model.md
* architecture/05-client-runtime.md

---

# Purpose

A Bundle is the immutable preservation unit of Archive Platform.

Every capture produces exactly one Bundle.

Bundles are:

* immutable
* self-describing
* portable
* versioned
* independently verifiable

A Bundle is the canonical representation of archived knowledge before encryption and storage.

---

# Design Goals

The Bundle format must:

* preserve captures faithfully
* be independent of storage implementation
* support future extensions
* support offline export/import
* survive decades of software evolution
* remain readable by independent implementations

The Bundle format is considered part of the platform specification.

Changes require versioning.

---

# Bundle Lifecycle

```text
Capture

↓

Normalize

↓

Generate Artifacts

↓

Generate Manifest

↓

Validate

↓

Freeze Bundle

↓

Encrypt

↓

Store As Immutable Object

↓

Optionally Synchronize As Objects Or Blocks
```

Once frozen, a Bundle never changes.

---

# Bundle Layout

Conceptually, every Bundle has the following structure.

```text
Bundle/

├── manifest.cbor

├── metadata.cbor

├── artifacts/
│      ...
```

The initial physical serialization is deterministic ZIP identified as `bundle:zip:v1`. Manifest and metadata values use canonical CBOR identified as `cbor:canonical:v1`.

ZIP entry ordering, timestamps, compression settings, and extra fields are fixed by the Bundle Specification so equivalent inputs produce byte-identical output.

---

# Manifest

The Manifest is the root document.

Every Bundle contains exactly one Manifest.

Responsibilities:

* bundle version
* bundle identifier
* creation timestamp
* format version
* artifact inventory
* checksums
* processing history

The Manifest is authoritative.

---

The canonical field contract and encoding are defined by the Bundle Manifest Specification.

---

# Metadata

Metadata describes the Bundle itself.

Examples:

```text
Archive ID

Capture ID

Capture Timestamp

Browser

Extension Version

Platform

Capture Method
```

Metadata never contains binary payloads.

---

# Preserved Artifacts

Preserved Artifacts represent source material.

Preserved Artifacts are historical facts.

They are never regenerated.

Examples:

```
page.mhtml

screenshot-full.png

favicon.ico

response_headers.json

additional future profile Artifacts
```

The exact asset list depends on capture type.

---

# Preserved Artifact Rules

Preserved Artifacts:

* preserve original information
* remain immutable
* have stable identifiers
* include checksums
* record MIME types

Preserved Artifacts should never contain AI-generated content.

---

# Derived Artifacts

Derived Artifacts represent generated information.

Artifacts may evolve over time.

Examples:

```
summary.md

keywords.json

entities.json

ocr.txt

embeddings.bin

translation.md

language.json
```

Artifacts are reproducible.

Preserved Artifacts are not.

---

# Derived Artifact Rules

Artifacts:

* reference source Artifacts
* record producing engine
* record producing model
* record generation timestamp
* record schema version

Multiple Artifacts of the same type may coexist.

Example:

```
summary-v1.md

summary-v2.md
```

---

# Relationships

Relationships describe references between Artifacts and are recorded in the Manifest.

Examples:

```
Summary

↓

Generated From

↓

page.html
```

or

```
Embedding

↓

Generated From

↓

OCR Text
```

Relationships allow provenance tracking.

---

# Signatures

Future versions may digitally sign Bundles.

Possible signatures:

* creator signature
* organization signature
* timestamp authority

MVP:

Reserved only.

---

# Bundle Identity

Every Bundle possesses a globally unique identifier.

The identifier remains stable forever.

Bundle IDs are independent of storage location.

---

# Bundle Version

Bundle Version identifies the archival format.

Changing the format increments:

```
Bundle Version
```

Changing the storage mechanism does not.

---

# Artifact Identity

Every Artifact receives:

* Artifact ID
* MIME Type
* Size
* Checksum

Artifacts are referenced by ID.

Never by filename.

Filenames are descriptive only.

---

Derived Artifacts additionally record generator, generator version, and schema version where applicable. This allows multiple AI engines to coexist.

---

# Bundle Validation

Before encryption every Bundle is validated.

Validation checks:

✓ Manifest exists

✓ Every Artifact referenced

✓ Checksums valid

✓ Required metadata present

Only valid Bundles may be frozen.

---

# Bundle Immutability

After validation:

```
Bundle

↓

Frozen
```

No file may be added.

No file may be removed.

No metadata may change.

Any modification creates a new Bundle.

---

# Serialization

The Bundle specification intentionally does not mandate serialization.

Possible implementations:

* TAR
* ZIP
* custom binary container

Clients must treat Bundle contents abstractly.

Serialization is a transport concern.

---

# Compression

Compression occurs after serialization.

```
Bundle

↓

Serialize

↓

Compress

↓

Encrypt
```

Compression must never modify Bundle semantics.

---

# Encryption

Encryption occurs after compression.

```
Bundle

↓

Compressed Bundle

↓

Encrypted Bundle
```

The Bundle itself is always defined in plaintext.

Only storage representations are encrypted.

---

# Block Generation

Encrypted Bundles are divided into Blocks.

```
Encrypted Bundle

↓

Block 1

Block 2

Block 3

...
```

Blocks possess no semantic understanding.

Blocks are storage primitives.

---

# Bundle Reconstruction

Reconstruction reverses the pipeline.

```
Blocks

↓

Reassemble

↓

Decrypt

↓

Decompress

↓

Deserialize

↓

Bundle
```

Only then are Artifacts visible.

---

# Forward Compatibility

Unknown optional sections should be ignored.

Unknown Artifact kinds and roles should be preserved.

Unknown metadata fields should remain intact.

Clients should never discard unknown Bundle contents.

---

# Bundle Export

Exporting a Bundle produces the canonical preservation package.

Properties:

* platform-independent
* self-contained
* immutable
* portable

Bundles should remain readable without the synchronization service.

---

# Design Decisions

## Why Self-Describing?

Bundles should remain understandable decades after creation.

A future implementation should not require external metadata.

---

## Why Distinguish Preserved and Derived Artifacts?

Historical preservation and interpretation evolve independently.

Separating them allows AI to improve without altering archived history.

---

## Why Version the Bundle?

Storage engines may evolve.

Synchronization protocols may evolve.

The archival format should evolve independently.

---

## Why Separate Serialization?

Bundles define logical structure.

Serialization defines physical representation.

Separating the two allows future optimization without changing the archive model.

---

# Future Extensions

Reserved directories:

```
annotations/

timelines/

citations/

knowledge_graph/

plugins/
```

Future clients may populate these without modifying existing Bundles.

---

# References

* `docs/architecture/07-content-storage.md`
* `docs/architecture/08-synchronization.md`
* `docs/architecture/11-search.md`
* `docs/architecture/12-processing-pipeline.md`
