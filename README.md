# AWSM

> A local-first, zero-knowledge knowledge preservation platform.

**AWSM** stands for **Archive What Should Matter**.

The project domain is `awsm.foo`.

## Overview

AWSM is an extensible platform for capturing, preserving, organizing, and enriching digital knowledge while ensuring that user content remains private. The system is designed around a zero-knowledge architecture: all user content is encrypted before leaving trusted client devices, and the cloud service never has access to plaintext data.

Unlike traditional web clipping or note-taking applications, AWSM is designed around immutable
captures rather than editable documents. A web Capture is one immutable Bundle graph whose MHTML,
full screenshot, thumbnail, normalized text, and structured content are independently encrypted
Artifacts. This preserves the exact source while allowing bounded-memory storage, verification, and
portable Complete Export and Import.

The browser extension can create a passphrase-protected Complete Vault Package and import that
package into a fresh or populated local Workspace. Import validates the entire encrypted package,
preserves authoritative Vault identity and history, provisions fresh device-local credentials, and
adds the result as a locked Vault. Import is not Backup, Restore, merging, or synchronization.

The platform is intended to support not only web pages, but eventually any digital artifact, including PDFs, emails, images, documents, transcripts, and other content types.

---

# Core Principles

## Local First

The client is the primary execution environment.

All critical functionality—including capture, search, AI processing, projection materialization, and viewing—must continue to function without network connectivity.

The cloud exists to synchronize data, not to enable the application.

---

## Zero Knowledge

The server never has access to decrypted user content.

All user content is encrypted before transmission.

Encryption keys are owned exclusively by the user.

---

## Immutable Captures

Captured content is immutable.

Derived artifacts such as summaries, OCR, tags, embeddings, or translations may evolve over time, but the original capture is never modified.

This guarantees long-term archival integrity.

---

## AI as a Client Capability

Artificial intelligence is considered a client-side feature.

AI operates only on decrypted content within trusted environments.

Generated artifacts are encrypted before synchronization.

The backend never performs inference on user content.

---

## Offline by Default

Users should be able to:

- browse archives
- search archives
- read captures
- annotate captures
- create folders
- generate AI artifacts

without requiring network connectivity.

Synchronization occurs opportunistically.

---

## Cloud as Coordination Layer

The backend provides:

- authentication
- account management
- billing
- encrypted object coordination
- device coordination
- encrypted storage
- sharing coordination

The backend is intentionally unaware of archive contents.

---

# Project Goals

The platform aims to provide:

- faithful preservation of web content
- long-term readability
- privacy-preserving synchronization
- high-performance local search
- extensibility through immutable artifacts
- support for future AI capabilities
- multi-device synchronization
- enterprise-grade security architecture

---

# Non-Goals

The platform is not intended to become:

- a collaborative document editor
- a real-time note-taking application
- a cloud document management system
- a server-side AI platform
- a centralized search engine

These capabilities may exist as optional services in the future but are outside the architectural goals of the platform.

---

# Repository Structure

```text
docs/plans/
docs/architecture/
docs/specifications/
```

Each directory documents one aspect of the platform. The architecture documents explain intent and trade-offs; the specifications define normative formats, protocols, and runtime contracts.

---

# Guiding Philosophy

The platform is built on a simple premise:

> Knowledge belongs to its owner.

The client captures knowledge.

The client encrypts knowledge.

The client understands knowledge.

The cloud merely coordinates encrypted Objects, Events, and wrapped keys between trusted devices.

Every architectural decision should reinforce this principle.

---

# Development Status

This repository documents the design and implementation of AWSM.

The implementation will proceed incrementally through well-defined phases, beginning with a minimal viable product focused on web page archival and expanding toward a general-purpose, privacy-preserving knowledge platform.
