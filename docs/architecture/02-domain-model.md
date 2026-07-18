# Domain Model

**Document:** `architecture/02-domain-model.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

* README.md
* VISION.md
* architecture/01-system-overview.md

---

# Purpose

This document defines the initial domain model for Archive Platform. The later Architecture Glossary and formal specifications are authoritative when terminology conflicts with this document.

Every component in the system—Host, Runtime, Services, Coordination Server, cryptography, AI, and storage—must use the canonical terminology defined in the Architecture Glossary.

This document deliberately separates:

* business concepts
* archival concepts
* storage concepts

These layers should not be confused.

---

# Domain Overview

The platform models knowledge using immutable snapshots.

The complete hierarchy is:

```text
User

└── Vault

      └── Archive

             ├── Capture #1

             │      └── Bundle

             ├── Capture #2

             │      └── Bundle

             └── Capture #3

                    └── Bundle
```

Notice that an **Archive** may contain multiple captures.

For example:

```text
https://rubyonrails.org/

Capture

2026-06-01

↓

Capture

2026-07-01

↓

Capture

2026-08-01
```

Each capture represents a historical snapshot.

---

# Layer 1 — Identity

## User

Represents an authenticated identity.

Responsibilities:

* login
* billing
* authentication
* device ownership
* vault membership

Users do **not** own captures.

Users own access to vaults.

---

## Device

Represents a trusted client.

Examples:

* Chrome Extension
* Firefox Extension
* Desktop App
* Mobile App

Each device possesses:

* device identifier
* encryption credentials
* synchronization state
* trusted status

Devices never own data.

---

# Layer 2 — Ownership

## Vault

A Vault is the primary ownership boundary.

Everything inside a vault shares:

* encryption keys
* synchronization state
* permissions
* storage quota

A vault contains:

* archives
* folders
* notes
* settings
* AI configuration

Future:

* team vaults
* shared vaults
* organization vaults

---

# Layer 3 — Knowledge

## Archive

An Archive represents a logical piece of knowledge.

Examples:

```text
Ruby on Rails Guides

OpenAI Blog

Personal Tax Return

Machine Learning Notes

Wikipedia - PostgreSQL
```

An archive is what users browse.

An archive is **not** a single file.

Instead:

```text
Archive

↓

Capture

↓

Capture

↓

Capture
```

---

## Why?

Suppose a user archives:

https://news.ycombinator.com

today

and again

three months later.

Those should appear as one archive containing multiple historical captures.

Not two unrelated items.

---

# Layer 4 — Preservation

## Capture

A Capture represents a single immutable snapshot.

Properties:

* timestamp
* source URL
* capture method
* browser version
* extension version

Captures never change.

Ever.

---

# Bundle

Every capture produces exactly one Bundle.

A Bundle is the complete preserved representation of that capture.

Conceptually:

```text
Capture

↓

Bundle
```

The Bundle is immutable.

---

A Bundle contains Artifacts, Metadata, and a Manifest.

---

# Preserved Artifacts

Preserved Artifacts are original preserved information.

Examples:

```text
page.mhtml

page.html

screenshot.webp

favicon.ico

cookies.json (optional)

headers.json

response.html
```

Preserved Artifacts preserve the original capture.

Preserved Artifacts are never regenerated.

---

# Derived Artifacts

Derived Artifacts are generated information.

Examples:

```text
summary.md

tags.json

keywords.json

entities.json

ocr.txt

embeddings.bin

translation.md
```

Artifacts may be regenerated.

Different AI models may produce different artifacts.

---

# Manifest

Every Bundle contains a Manifest.

Example:

```yaml
bundle_version: 1

capture_time:

browser:

  artifacts:

  processing_history:

checksums:

encryption:
```

The Manifest describes the Bundle. The initial serialized Manifest uses canonical CBOR inside the deterministic Bundle ZIP.

It does not contain large binary content.

---

# Layer 5 — Storage

The Bundle is transformed into storage objects.

```text
Bundle

↓

Encrypt

↓

Chunk

↓

Objects
```

---

## Object

Objects are immutable encrypted binary blobs.

Properties:

* object id
* object hash
* encrypted payload
* object size

Objects know nothing about:

* archives
* captures
* AI

Objects are storage primitives.

---

Objects are content-addressed.

```text
SHA-256

↓

Object ID
```

---

# Why Chunk?

Large archives become:

```text
Bundle

↓

Chunk

↓

Object A

Object B

Object C
```

Advantages:

* resumable uploads

* partial downloads

* deduplication

* corruption isolation

---

# Relationships

```text
User

↓

Vault

↓

Archive

↓

Capture

↓

Bundle

├── Artifacts

└── Manifest

↓

Encrypted Objects
```

This hierarchy should remain stable.

---

# Folders

Folders are user-defined organization.

Example:

```text
Programming

Finance

Recipes

Travel
```

Folders reference Archives.

Never captures.

---

# Notes

Notes are user-generated content.

Notes belong to Archives.

Not Bundles.

Reason:

A note usually describes the subject.

Not one historical snapshot.

Future enhancement:

Snapshot-specific notes.

---

# Tags

Tags belong to Archives.

Not Captures.

Reason:

Users think:

"This is about Ruby."

Not:

"The June capture is Ruby."

AI-generated tags belong to Artifacts.

User tags belong to Archives.

---

# AI Outputs

AI always produces Artifacts.

Never preserved Artifacts.

Examples:

```text
Summary

↓

Artifact

Embedding

↓

Artifact

Translation

↓

Artifact
```

This allows AI improvements without changing preserved history.

---

# Deletion

Deletion occurs at multiple levels.

Delete Capture

↓

Archive remains.

Delete Archive

↓

All captures removed.

Delete Vault

↓

Everything removed.

---

# Export

Exporting an Archive exports:

all captures

all bundles

all artifacts

history

manifest

Exporting a Vault exports:

every archive

every folder

every note

every setting

---

# Design Decisions

## Why Archives contain Captures

Historical preservation.

Allows:

* scheduled recapture
* timeline views
* change detection
* legal evidence

---

## Why Bundles exist

Bundles isolate preservation from storage.

Storage can evolve.

Bundle format remains stable.

---

## Why distinguish preserved and derived Artifacts?

Preserved Artifacts are historical facts.

Derived Artifacts are interpretations.

Interpretations change.

Facts do not.

---

## Why Objects are storage primitives

Allows:

* new storage engines

* different synchronization protocols

* cloud providers

without affecting users.

---

# Future Extensions

The model naturally supports:

Version comparison

↓

Archive timelines

↓

Scheduled captures

↓

Knowledge graphs

↓

AI agents

↓

Encrypted collaboration

↓

Alternative storage providers

without changing the hierarchy.

---

# Domain Glossary

| Term     | Meaning                          |
| -------- | -------------------------------- |
| User     | Authenticated identity           |
| Device   | Trusted client                   |
| Vault    | Cryptographic ownership boundary |
| Archive  | Logical knowledge item           |
| Capture  | Immutable historical snapshot    |
| Bundle   | Complete preserved capture       |
| Artifact | Immutable Bundle payload, preserved or derived |
| Manifest | Bundle metadata                  |
| Object   | Encrypted immutable storage blob |

This glossary is the canonical terminology for the project.
