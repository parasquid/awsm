# Coordination Server Architecture

**Document:** `architecture/15-coordination-server.md`

**Status:** Draft

**Owner:** Engineering

**Primary Implementation:** Ruby on Rails

**Depends On:**

- architecture/08-synchronization.md
- architecture/14-trust-and-device-management.md

---

# Purpose

The Coordination Server provides authenticated synchronization and storage coordination for Archive Platform.

It intentionally does not possess the ability to decrypt user Vaults.

Its primary responsibilities are:

- authentication
- authorization
- synchronization coordination
- object storage coordination
- tenant management
- device trust
- event distribution

---

# Design Goals

The server must provide:

- horizontal scalability
- stateless request handling
- zero-knowledge operation
- resumable synchronization
- tenant isolation
- high availability

---

# Philosophy

The Client Runtime owns intelligence.

The Coordination Server owns coordination.

The server should remain unaware of archive contents.

---

# High-Level Architecture

```
                 Internet

                     │

              HTTPS API Gateway

                     │

               Rails Application

     ┌──────────┬──────────┬──────────┐

 Authentication  Sync      Trust

 Tenant Mgmt     Events    Storage

                     │

          PostgreSQL Metadata

                     │

             Object Storage
```

---

# Responsibilities

The server owns:

- user accounts
- tenant accounts
- authentication
- authorization
- device registration
- wrapped Vault Root Keys
- Event Log persistence
- Block registry
- notifications

The server does not own:

- search
- AI
- OCR
- archive rendering
- Bundle creation
- encryption
- decryption

---

# Major Services

## Authentication Service

Responsibilities:

- login
- passkeys
- OAuth
- session management
- token issuance

Authentication proves identity.

It does not grant Vault access.

---

## Tenant Service

Responsibilities:

- tenant lifecycle
- billing integration
- quotas
- subscription state
- feature flags

The Tenant Service never accesses Vault contents.

---

## Trust Service

Responsibilities:

- device enrollment
- public keys
- wrapped Vault Root Keys
- revocation
- key rotation metadata

Private keys never reach the server.

---

## Synchronization Service

Responsibilities:

- Event persistence
- Event ordering
- Event distribution
- synchronization cursors

The Synchronization Service stores encrypted Event payloads.

---

## Block Registry

Responsibilities:

- Block existence
- Bundle → Block mapping
- reference counting
- garbage collection scheduling

The Registry never stores plaintext.

---

## Storage Adapter

Responsibilities:

- upload coordination
- download coordination
- backend abstraction

Supported providers:

- S3
- MinIO
- Azure Blob
- Google Cloud Storage
- Local development

---

## Notification Service

Responsibilities:

- notify connected clients
- wake sleeping devices
- publish synchronization hints

Notifications never contain archive contents.

---

# Persistence

The server maintains metadata only.

Examples:

Users

Tenants

Devices

Wrapped Keys

Events

Block References

Synchronization State

No decrypted archive data is persisted.

---

# Request Pipeline

```
HTTPS Request

↓

Authentication

↓

Authorization

↓

Application Service

↓

Domain Service

↓

Repository

↓

Persistence
```

Controllers should remain thin.

Business logic belongs in services.

---

# Object Storage

Encrypted Blocks are stored outside PostgreSQL.

```
Rails

↓

Storage Adapter

↓

Object Store
```

PostgreSQL stores only references.

---

# Horizontal Scaling

Every API instance should be stateless.

Shared infrastructure:

- PostgreSQL
- Object Storage
- Cache
- Message Broker (future)

Requests may be served by any instance.

---

# Synchronization Workflow

```
Client

↓

Upload Blocks

↓

Commit Event

↓

Persist Event

↓

Notify Devices
```

The server does not reconstruct Vault state.

---

# Authentication vs Authorization

Authentication:

Who is this user?

Authorization:

May this device access this tenant and receive synchronization metadata?

Vault decryption is independent of both.

---

# Multi-Tenancy

Each tenant owns:

- users
- devices
- Vault metadata
- billing state
- quotas

Tenant isolation must be enforced at every persistence boundary.

---

# Observability

The server records operational metrics only.

Examples:

- request latency
- synchronization duration
- upload throughput
- storage utilization
- error rates

Logs must never contain decrypted archive contents.

---

# Error Handling

Failures should be idempotent.

Examples:

Duplicate Block upload:

Success.

Duplicate Event:

Ignored.

Repeated Commit:

Safe.

Interrupted Upload:

Resume.

---

# Security

The server should assume every incoming payload is untrusted.

Validation includes:

- authentication
- authorization
- schema validation
- signature verification (where applicable)
- quota enforcement

The server never attempts to interpret encrypted payloads.

---

# Design Decisions

## Why Coordination Instead of Processing?

Separating coordination from content processing preserves the zero-knowledge model and enables lightweight server infrastructure.

---

## Why Stateless Services?

Stateless services simplify scaling, deployment, and fault recovery.

---

## Why External Object Storage?

Object storage is optimized for immutable binary data and scales independently of relational metadata.

---

## Why Thin Controllers?

Business logic becomes reusable across transports and easier to test.

---

# Future Extensions

Potential additions include:

- WebSocket synchronization
- Push notifications
- Regional replication
- Tenant-managed storage backends
- Audit exports
- Administrative APIs

These extensions should not require changes to the client runtime.

---

# References

- `docs/architecture/16-archive-protocol.md`
- `docs/architecture/18-cryptography.md`
- `docs/architecture/20-deployment-and-operations.md`
