# Deployment & Operations

**Document:** `docs/architecture/20-deployment-and-operations.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/15-coordination-server.md
- architecture/16-archive-protocol.md
- architecture/18-cryptography.md
- architecture/19-testing-strategy.md

---

# Purpose

This document defines how Archive Platform is deployed, operated, monitored, and upgraded.

The deployment architecture should support both a single-node MVP and a horizontally scalable SaaS deployment without requiring protocol or architectural changes.

---

# Design Goals

The operational architecture must provide:

- simple local development
- straightforward self-hosting
- horizontal scalability
- rolling upgrades
- tenant isolation
- disaster recovery
- observability

---

# Philosophy

Deployment should not influence application architecture.

The same logical services should exist regardless of deployment size.

Scaling changes infrastructure, not behavior.

---

# Logical Services

The platform consists of the following logical services:

```
Identity Service

Coordination Service

Object Storage

Notification Service

Billing Service (future)

Monitoring Stack
```

Multiple logical services may execute within the same process for the MVP.

---

# MVP Deployment

Recommended deployment:

```
Docker Compose

├── Rails
├── PostgreSQL
├── Redis
├── MinIO
└── Reverse Proxy
```

This configuration supports:

- development
- demonstrations
- small self-hosted installations

---

# Production Deployment

Typical SaaS deployment:

```
Internet

↓

Load Balancer

↓

Rails API Instances

↓

PostgreSQL

↓

Redis

↓

Object Storage

↓

Background Workers

↓

Monitoring
```

Every Rails instance should be stateless.

---

# Stateless Services

Application instances should store no persistent local state.

Persistent data belongs in:

- PostgreSQL
- Object Storage
- Redis (ephemeral)
- Secure secret storage

Stateless services simplify scaling and recovery.

---

# Object Storage

Encrypted Blocks reside in external object storage.

Supported providers may include:

- Amazon S3
- MinIO
- Google Cloud Storage
- Azure Blob Storage

The application interacts through a Storage Adapter.

---

# Database

PostgreSQL stores:

- users
- tenants
- devices
- wrapped keys
- event metadata
- synchronization cursors
- block references

Encrypted archive contents do not reside in PostgreSQL.

---

# Background Workers

Long-running server-side work may execute in background workers.

Examples:

- garbage collection
- quota recalculation
- billing synchronization
- notification delivery

Workers never decrypt user content.

---

# Redis

Redis provides ephemeral infrastructure.

Possible uses:

- job queues
- distributed locks
- rate limiting
- notification fan-out
- caching

Redis should not contain authoritative state.

---

# Reverse Proxy

Responsibilities:

- TLS termination
- request routing
- compression
- rate limiting
- HTTP/2 and HTTP/3 support (when available)

---

# Configuration

Configuration should originate from environment variables or managed secret stores.

Secrets should never be committed to source control.

---

# Secrets Management

Production deployments should support:

- cloud secret managers
- encrypted environment variables
- hardware security modules (future)

Development deployments may use local `.env` files.

---

# Scaling

Scaling should occur independently for:

- API instances
- workers
- object storage
- database

No application redesign should be required.

---

# Deployment Changes

Before the first release, deployments use:

- one canonical Service schema
- one canonical protocol
- one current client population

Post-release rollout and data-change policy requires an explicit user decision.

---

# Disaster Recovery

Recovery procedures should cover:

- PostgreSQL restoration
- object storage restoration
- configuration recovery
- secret restoration

Client Vault contents remain encrypted throughout recovery.

---

# Monitoring

Operational metrics may include:

- request latency
- synchronization throughput
- upload throughput
- storage utilization
- worker queue depth
- database performance

Operational telemetry must exclude plaintext archive contents.

---

# Logging

Logs should include:

- request identifiers
- tenant identifiers (where appropriate)
- operation identifiers
- protocol versions

Logs must not include:

- decrypted archive content
- Vault keys
- plaintext metadata
- Artifact plaintext, plaintext checksums, or decrypted Bundle Descriptor metadata

Local diagnostics may report opaque Object IDs, wrapper lengths/checksums, Job stage, and typed
errors. They SHALL NOT report derived content meaning. Temporary Vault Package files and prepared
Artifact wrappers require startup cleanup; authoritative Artifact records with unavailable wrappers
are integrity failures and must not be silently discarded.

---

# Health Checks

Each service should expose health endpoints.

Examples:

- liveness
- readiness
- dependency health

---

# Rate Limiting

The platform should support configurable rate limits for:

- authentication
- uploads
- synchronization
- device enrollment
- public APIs

Limits may vary by tenant plan.

---

# Backup Strategy

Operational server backup covers infrastructure state:

- PostgreSQL
- configuration
- wrapped keys

Object storage backup depends on the chosen provider.

Encrypted client content remains opaque to operators.

Vault recovery uses Snapshot-based Backup Sets as defined by `docs/specifications/portability/backup.md`. Operational database backup is not a substitute for Vault Backup or Restore semantics.

---

# Client Import Cleanup

Import staging and prepared wrappers are client-local operational data. Startup reconciliation
marks non-terminal Import Jobs interrupted, removes only the Job-derived source path, and removes
only wrappers in an authenticated destination scope after proving that no Vault directory entry
committed. Diagnostics allow only Job IDs, stages, counters, safe error IDs, and timing; they exclude
filenames, passphrases, keys, Vault names, titles, URLs, and decrypted content.

# Design Decisions

## Why Stateless Services?

Stateless services simplify scaling, upgrades, and failure recovery.

---

## Why External Object Storage?

Object stores are optimized for immutable binary data and independent scaling.

---

## Why Separate Logical Services?

Logical separation allows deployment flexibility while preserving a stable architecture.

---

## Why Support Single-Node Deployment?

Simple deployments encourage adoption, testing, and self-hosting.

---

# Future Extensions

Potential operational enhancements include:

- multi-region replication
- active-active deployments
- tenant-specific storage backends
- autoscaling
- CDN integration
- edge synchronization gateways

---

# References

- `docs/specifications/runtime/runtime.md`
- `docs/specifications/portability/backup.md`
- `docs/specifications/portability/restore.md`
