# Processing Pipeline

**Document:** `architecture/12-processing-pipeline.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/05-client-runtime.md
- architecture/09-event-model.md
- architecture/10-projection-engine.md
- architecture/11-search.md

---

# Purpose

This document defines the asynchronous processing architecture used by Archive Platform.

The processing pipeline submits background Jobs through the Runtime Job Framework to derive new information from immutable Bundles.

Processing never modifies existing Bundles.

Instead, processors produce immutable Derived Artifacts and emit Runtime Events that Projection Builders consume.

---

# Design Goals

The processing pipeline must provide:

- asynchronous execution
- resumable processing
- deterministic outputs where practical
- provider independence
- offline operation
- extensibility
- zero-knowledge processing

---

# Philosophy

Bundles preserve history.

Artifacts derive knowledge.

Events record change.

Processing transforms Bundles into Artifacts.

---

# Processing Pipeline

```
BundleRegistered Runtime Event

↓

Runtime Job Scheduler

↓

Runtime Job Store

↓

Processor

↓

Derived Artifact

↓

ArtifactCreated Runtime Event

↓

Projection Engine
```

---

# Processing Stages

Every job follows the same lifecycle.

```
Queued

↓

Running

↓

Completed

↓

Artifact Created

↓

Event Recorded
```

Failed jobs remain retryable.

---

# Runtime Job Scheduler

Responsibilities:

- discover new work
- schedule processing
- enforce dependencies
- prioritize jobs
- avoid duplicate execution

The scheduler is deterministic.

---

# Runtime Job Store

The Runtime Job Store contains pending work.

Each job records:

- Job ID
- Job Type
- Priority
- Dependencies
- Status
- Retry Count
- Created Time
- Started Time
- Finished Time

Jobs are local to the client.

They are never synchronized.

---

# Processors

Processors execute jobs.

Examples:

AI Summary

OCR

Language Detection

Entity Extraction

Keyword Extraction

Embedding Generation

Thumbnail Generation

Duplicate Detection

Virus Scan (future)

Broken Link Validation (future)

Each processor is independent.

---

# Artifact Model

Processors never modify Bundles.

Instead they create immutable Artifacts.

Example:

```
Bundle

↓

OCR Processor

↓

OCR Artifact
```

or

```
Bundle

↓

Summary Processor

↓

Summary Artifact
```

Artifacts reference their source Bundle.

---

# Artifact Metadata

Every Artifact records:

- Artifact ID
- Source Bundle ID
- Processor
- Processor Version
- Model (if applicable)
- Schema Version
- Creation Time
- Checksum

Artifacts are immutable.

---

# AI Providers

The architecture supports multiple AI providers.

Examples:

- Local LLM
- Cloud LLM
- Future plugin providers

Providers implement a common processor interface.

The scheduler remains provider-agnostic.

---

# Processor Isolation

Processors do not communicate directly.

Instead:

```
ArtifactCreatedEvent

↓

Scheduler

↓

Dependent Jobs
```

Dependencies are expressed through Events.

---

# Incremental Processing

Only newly created Bundles require processing.

Existing Artifacts remain valid unless explicitly regenerated.

---

# Regeneration

Regeneration creates new Artifacts.

Older Artifacts remain available until explicitly superseded by policy.

Example:

```
Summary v1

↓

Summary v2
```

Both remain immutable.

The active version is determined by Projections.

---

# Failure Handling

Processor failure never blocks synchronization.

Failed jobs:

- remain local
- may be retried
- never corrupt authoritative data

---

# Resource Management

The scheduler should support:

- background execution
- CPU limits
- memory limits
- battery awareness
- idle-time execution

The host application provides platform-specific scheduling hints.

---

# Privacy

All processing occurs within the trusted runtime.

Plaintext never leaves the client unless the user explicitly enables a cloud provider.

Cloud AI providers must be treated as an explicit opt-in capability.

---

# Event Integration

Processors append Events.

Examples:

ArtifactCreatedEvent

ArtifactSupersededEvent

ArtifactDeletedEvent

These Events synchronize between devices.

The processing job itself does not.

---

# Design Decisions

## Why Artifacts?

Derived information should remain separate from preserved historical content.

---

## Why Jobs?

Jobs allow long-running and retryable processing without affecting user interaction.

---

## Why Local Scheduling?

Scheduling depends on device capabilities and should not require server coordination.

---

## Why Provider Independence?

The runtime should support multiple implementations without changing higher-level architecture.

---

# Future Extensions

The processing framework may later support:

- plugin-defined processors
- chained workflows
- user-defined automations
- distributed processing
- hardware acceleration
- GPU scheduling

These additions should require no changes to the Event Model.

---

# References

- `docs/architecture/13-capture-pipeline.md`
- `docs/architecture/17-extension-framework.md`
