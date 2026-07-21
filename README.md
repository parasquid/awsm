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

The Chrome extension can run local-only or connect to a user-selected compatible Coordination
Server. An Account uses email/password authentication without email delivery, enrolls exactly one
Vault through a client-created Account Encryption Key slot, and synchronizes the Complete encrypted
Replica while retaining offline access through its device-local slot. The server stores opaque
ciphertext and wrapped keys only. Polling is sufficient for convergence; Action Cable is advisory.
When a local Replica is stale, AWSM offers a Complete Export, re-authors its current logical state as
a fresh local-only Vault, and only then replaces the synchronized Vault with verified server data.
An authenticated Vault can move between compatible Coordination Servers without signing out first:
AWSM verifies the candidate Account and Root Key, publishes an empty candidate, safely unions
same-Generation append-only history, fast-forwards only with cryptographic ancestry proof, and
reports divergent Generations without overwriting either side.

The implementation remains pre-release. Device signing/revocation, Account Recovery Keys, password
change, quotas, shared object storage, billing, and production deployment hardening remain future
work.

---

# Install the Chrome Extension

AWSM is pre-release and is not available from the Chrome Web Store. Install it as an unpacked
developer-mode extension. Release notes provide a brief installation procedure alongside a Chrome
ZIP and its SHA-256 checksum.

## From a GitHub Release

Follow the [full Chrome extension installation guide](docs/guides/install-chrome-extension.md) to
download the correct GitHub Release assets, verify the checksum, load the unpacked extension, and
upgrade or troubleshoot an installation safely.

## Build From Source

The development environment requires Node.js 22 and Corepack. From a clone of this repository, run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Then use **Load unpacked** in `chrome://extensions` and select:

```text
apps/browser-extension/.output/chrome-mv3
```

To create the distributable Chrome ZIP locally, run:

```bash
corepack pnpm zip
```

After installation, open the AWSM toolbar icon and choose a compatible self-hosted Coordination
Server or continue without synchronization. The hosted service is not currently advertised as an
available public service.

## Maintainer Release Procedure

1. Update `version` in `apps/browser-extension/package.json`.
2. Commit and push that change to `main`.
3. Create the `v<version>` tag at that commit.
4. Push the tag.
5. Wait for the Chrome Extension Release workflow to validate the build and publish the Release.

Versions ending in `-alpha.N`, `-beta.N`, or `-rc.N` create prereleases. Plain versions create
stable Releases. Failed validation creates no Release. Before retrying with changed code, handle the
existing tag explicitly; the workflow never moves, replaces, or overwrites a tag or Release.

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

For a connected Account, users may explicitly free browser storage by removing locally stored
`PRIMARY` and full-screenshot wrappers only after AWSM proves byte-identical encrypted copies belong
to the active Coordination Server Generation. Compact Library data remains local. Opening or
downloading a remote-only Artifact retrieves and verifies it through the trusted Runtime, normally
restoring it locally; offline or signed-out access explains that Account access is required rather
than reporting corruption. Complete Export still includes every Artifact without rehydrating these
wrappers.

---

## Cloud as Coordination Layer

The backend provides:

- authentication
- account management
- encrypted object coordination
- encrypted storage

Billing, Device coordination, and sharing coordination remain future capabilities.

The backend is intentionally unaware of archive contents.

If a synchronized device is stale after Vault Vacuum, AWSM keeps it read-only, offers Complete
Export first, and requires explicit acknowledgement before atomically replacing it with verified
server state. This discard creates no hidden recovery Vault.

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

---

# License

AWSM is free software licensed under the GNU Affero General Public License, version 3 or
any later version. See [`LICENSE`](LICENSE) for the full terms.
