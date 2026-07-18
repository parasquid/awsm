# Extension Framework

**Document:** `architecture/17-extension-framework.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/05-client-runtime.md
- architecture/09-event-model.md
- architecture/10-projection-engine.md
- architecture/12-processing-pipeline.md

---

# Purpose

This document defines the Extension Framework used to extend Archive Platform.

Extensions add functionality without modifying the core runtime.

The framework is capability-based and event-driven.

Extensions execute entirely within the trusted client runtime.

---

# Design Goals

The framework must provide:

- isolation
- stability
- version compatibility
- capability-based security
- deterministic behavior
- offline operation
- forward compatibility

---

# Philosophy

The core runtime owns authoritative state.

Extensions contribute functionality.

Extensions never bypass validation.

---

# Architecture

```
Extension

↓

Extension Host

↓

Core Runtime

↓

Commands

↓

Events

↓

Projection Engine
```

The Extension Host mediates all interactions.

---

# Extension Lifecycle

```
Discover

↓

Load

↓

Validate

↓

Initialize

↓

Execute

↓

Shutdown
```

Extensions should be restartable without affecting the Vault.

---

# Extension Manifest

Each extension provides a manifest.

Required fields:

- Extension ID
- Name
- Version
- Author
- API Version
- Requested Capabilities
- Entry Point

Optional fields:

- Description
- Homepage
- License
- Supported Platforms

---

# Capabilities

Extensions request explicit capabilities.

Examples:

Capture

Search

Processing

Projection

Commands

Notifications

Settings

Storage (future)

Capabilities must be approved by the user before activation.

---

# Extension Types

The framework supports multiple extension types.

## Capture Adapters

Examples:

- Browser Adapter
- PDF Import
- Email Import

---

## Search Providers

Examples:

- Code Search
- Image Search
- Citation Search

---

## Processors

Examples:

- OCR
- AI Summary
- Thumbnail Generation
- Duplicate Detection

---

## Projections

Examples:

- Reading Statistics
- Knowledge Graph
- Citation Index

---

## UI Extensions

Examples:

- Sidebar panels
- Inspector views
- Context menus
- Toolbar actions

UI extensions should communicate through public APIs only.

---

# Commands

Extensions may request Commands.

Examples:

CreateArchiveCommand

CreateTagCommand

AddBundleCommand

Commands undergo normal validation.

---

# Events

Extensions may observe Events.

Examples:

ArchiveCreatedEvent

BundleRegisteredEvent

ArtifactCreatedEvent

DeviceRevokedEvent

Extensions must treat Events as immutable.

Extensions cannot emit Events directly.

---

# Extension APIs

Stable APIs include:

- Command API
- Event Subscription API
- Search API
- Bundle API (read-only)
- Artifact API
- Settings API
- Notification API

Each API is independently versioned.

---

# Sandboxing

Extensions execute in an isolated environment.

Restrictions include:

- no direct database access
- no direct Event Log modification
- no direct Projection modification
- no filesystem access unless granted
- no unrestricted network access unless granted

The host mediates all privileged operations.

---

# Versioning

The Extension API uses semantic versioning.

Breaking changes require a new major version.

Older extensions should continue functioning whenever practical.

---

# Error Handling

Extension failures are isolated.

If an extension crashes:

- unload extension
- record diagnostics
- continue runtime operation

One faulty extension must not compromise the Vault.

---

# Performance

The host may enforce:

- CPU limits
- memory limits
- execution timeouts
- concurrency limits

Extensions should avoid blocking the user interface.

---

# Security

Extensions execute with the principle of least privilege.

Users may revoke granted capabilities at any time.

The framework should clearly indicate which capabilities an extension has been granted.

---

# Testing

Extension authors should be able to test against a reference runtime.

The SDK should provide:

- mock Event Log
- mock Projection Engine
- mock Search API
- protocol simulators

---

# Future Extensions

Possible future extension points include:

- synchronization hooks
- custom processors
- workflow automation
- export formats
- visualization modules
- collaborative tools

---

# Design Decisions

## Why Commands Instead of Events?

The runtime remains the sole authority responsible for validating and recording history.

---

## Why Capability-Based Security?

Explicit capabilities reduce the impact of faulty or malicious extensions.

---

## Why Stable APIs?

Extensions should continue working across runtime upgrades whenever compatibility permits.

---

## Why Sandboxing?

Isolation improves reliability and security.

---

# Open Questions

Should extensions be signed before installation?

Should organizations be able to define extension allowlists?

Should extensions support background services that survive UI shutdown?

How should extension updates be coordinated with API version changes?

---

# References

- `docs/architecture/18-cryptography.md`
- `docs/architecture/19-testing-strategy.md`
- `docs/specifications/runtime/runtime.md`
