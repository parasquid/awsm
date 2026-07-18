# Archive Protocol

**Document:** `architecture/16-archive-protocol.md`

**Status:** Draft

**Owner:** Engineering

**Primary Transport:** HTTPS + JSON (MVP)

**Depends On:**

- architecture/08-synchronization.md
- architecture/14-trust-and-device-management.md
- architecture/15-coordination-server.md

---

# Purpose

This document defines the Archive Protocol.

The Archive Protocol specifies the communication contract between Client Runtimes and the Coordination Server.

The protocol is transport-independent.

The MVP uses HTTPS with JSON serialization.

---

# Design Goals

The protocol must provide:

- transport independence
- resumable synchronization
- idempotent operations
- zero-knowledge compatibility
- version negotiation
- extensibility

---

# Philosophy

The protocol exposes primitives.

It does not expose application workflows.

The Client Runtime owns workflow orchestration.

---

# Layers

```
Client Runtime

↓

Archive Protocol

↓

Transport

↓

Coordination Server
```

---

# Transports

Supported transports may include:

- HTTPS/JSON (MVP)
- gRPC
- WebSocket
- Local IPC
- Test Transport

All transports implement the same protocol semantics.

---

# Protocol Operations

The protocol consists of primitive operations.

Examples:

Authenticate

FetchEvents

CommitEvent

UploadBlock

DownloadBlock

QueryBlockExistence

EnrollDevice

FetchWrappedKeys

RotateVaultKey

SubscribeNotifications

No operation exposes mutable archive state.

---

# Operation Properties

Every operation should be:

- authenticated
- authorized
- idempotent where possible
- versioned
- independently testable

---

# Authentication

Authentication establishes user identity.

The protocol does not mandate an authentication mechanism.

Possible implementations include:

- OAuth 2.1
- OpenID Connect
- Passkeys
- Session tokens

Authentication is separate from Vault trust.

---

# Authorization

Authorization determines whether the authenticated device may perform an operation.

Examples:

- access tenant
- fetch Event Log
- upload Blocks
- retrieve wrapped keys

Vault decryption remains a client concern.

---

# Version Negotiation

Every request includes:

Protocol Version

Client Version

Capability Set

The server may reject unsupported protocol versions.

---

# Idempotency

The following operations should be idempotent:

UploadBlock

CommitEvent

EnrollDevice (where applicable)

Duplicate requests should produce identical observable results.

---

# Error Model

Errors should be structured.

Examples:

AuthenticationFailed

AuthorizationDenied

ProtocolVersionUnsupported

MissingBlock

QuotaExceeded

InvalidSignature

InvalidEvent

UnknownOperation

Clients should classify errors as:

Retryable

Non-retryable

---

# Synchronization

Synchronization consists of protocol operations.

Example:

```
FetchEvents

↓

Determine Missing Blocks

↓

Download Blocks

↓

Replay Events
```

The server never executes synchronization workflows.

---

# Notifications

Notifications are advisory.

Examples:

New Events

Vault Updated

Device Revoked

Notifications should contain no decrypted content.

---

# Block Transfer

Blocks are opaque binary objects.

The protocol treats Blocks as immutable.

Block contents are never interpreted by the server.

---

# Event Transfer

Events contain encrypted payloads.

The server stores and forwards Events.

The server does not inspect payload semantics.

---

# Device Enrollment

Enrollment consists of protocol operations.

Example:

Generate Device Keys

↓

Authenticate

↓

Upload Public Key

↓

Receive Wrapped Vault Root Key

↓

Begin Synchronization

---

# Capability Discovery

Clients may query supported capabilities.

Examples:

Protocol Version

Maximum Block Size

Notification Support

Compression Algorithms

Supported Authentication Methods

---

# Streaming

Future protocol versions may support streaming.

Examples:

Streaming Block Upload

Streaming Event Download

Live Notifications

Streaming should not alter protocol semantics.

---

# Extensibility

Unknown protocol operations should be rejected gracefully.

Unknown fields should be preserved where possible.

The protocol is designed for forward compatibility.

---

# Security

All protocol traffic must use authenticated encrypted transport.

Protocol messages should avoid revealing archive semantics.

Sensitive information should remain encrypted end-to-end where practical.

---

# Design Decisions

## Why Protocol Instead of REST?

A protocol outlives transport choices and allows multiple implementations.

---

## Why Primitive Operations?

Primitive operations compose into workflows while keeping the server simple.

---

## Why Client-Orchestrated Workflows?

The Client Runtime owns state and synchronization logic.

The server provides durable coordination only.

---

## Why Version Negotiation?

Independent evolution of clients and servers requires explicit compatibility management.

---

# Future Extensions

Possible protocol additions include:

- batch operations
- delta synchronization
- peer-to-peer relay
- transport compression negotiation
- server push
- multiplexed streams

These extensions should preserve the core protocol model.

---

# References

- `docs/architecture/17-extension-framework.md`
- `docs/architecture/18-cryptography.md`
- `docs/architecture/20-deployment-and-operations.md`
