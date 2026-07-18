# Runtime Specification

**Document:** `specifications/runtime/runtime.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Runtime provides the execution environment for the Archive Platform.

It coordinates storage, synchronization, capture, search, AI processing, and extension services.

The Runtime is independent of any particular browser or operating system.

---

# 2. Design Goals

The Runtime MUST provide:

- offline operation
- deterministic behavior
- portability
- service isolation
- extensibility
- fault tolerance

---

# 3. Runtime Architecture

Conceptually:

```
Host

↓

Runtime

↓

Services

↓

Platform APIs
```

The Host supplies platform integration.

The Runtime supplies application behavior.

---

# 4. Host Responsibilities

Hosts provide:

- browser permissions
- lifecycle events
- UI integration
- network access
- filesystem access (where available)

Examples:

- Chrome Extension
- Firefox Extension
- Electron
- Native Desktop

---

# 5. Runtime Responsibilities

The Runtime coordinates:

- Vault management
- synchronization
- object storage
- capture pipeline
- search
- AI processing
- event processing
- projection rebuilding

---

# 6. Services

The Runtime is composed of independent services.

Standard services include:

- Storage Service
- Capture Service
- Synchronization Service
- Search Service
- AI Service
- Event Service
- Projection Service
- Trust Service

Future services MAY be introduced.

---

# 7. Service Communication

Services communicate through well-defined interfaces.

Services MUST NOT access each other's internal state directly.

Communication SHOULD be asynchronous where practical.

---

# 8. Lifecycle

The Runtime SHALL support:

- startup
- shutdown
- suspend
- resume
- recovery

Unexpected termination MUST NOT corrupt persistent state.

---

# 9. Fault Isolation

Service failures SHOULD remain isolated.

One failing service MUST NOT terminate unrelated services.

---

# 10. Configuration

Runtime configuration SHALL be versioned.

Configuration MAY include:

- enabled services
- storage backend
- AI providers
- synchronization policy

Sensitive configuration MUST be encrypted.

---

# 11. Background Work

The Runtime MAY execute background tasks.

Examples:

- synchronization
- projection rebuild
- AI processing
- garbage collection

Tasks SHOULD be resumable after interruption.

---

# 12. Observability

The Runtime SHOULD expose structured diagnostics.

Examples:

- service health
- synchronization progress
- storage statistics
- queue depth

Diagnostics MUST NOT expose decrypted user content.

---

# 13. Extension Points

Services MAY expose extension APIs.

Extensions SHALL interact through Commands and Events.

Extensions MUST NOT bypass Runtime services.

---

# 14. Invariants

The Runtime is platform-independent.

Services are isolated.

Persistent state survives Runtime restarts.

The Host does not implement business logic.

---

# References

vault/vault.md

protocol/protocol.md

storage/object-store.md

crypto/crypto.md
