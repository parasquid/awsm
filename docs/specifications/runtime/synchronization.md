# Synchronization Service Specification

**Document:** `specifications/runtime/synchronization.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Synchronization Service reconciles the local Vault replica with one or more remote replicas.

Synchronization is transport-independent and coordinates immutable Objects and Events.

---

# 2. Design Goals

The Synchronization Service MUST provide:

- eventual consistency
- resumable execution
- offline operation
- deterministic reconciliation
- fault tolerance
- bandwidth efficiency

---

# 3. Architecture

```
Runtime

↓

Synchronization Service

↓

Archive Synchronization Protocol

↓

Coordination Server
```

The Synchronization Service owns synchronization policy.

The Protocol defines message formats.

---

# 4. Synchronization Model

Synchronization is reconciliation between replicas.

Neither replica is inherently authoritative.

The goal is convergence.

---

# 5. Synchronization Job Lifecycle

Every synchronization run executes as a Synchronization Job submitted to the Runtime Job Framework.

The Synchronization Service defines synchronization behavior and Work Items. The Job Framework owns scheduling, persistence, retries, cancellation, and recovery.

---

# 6. Synchronization Lifecycle

Conceptually:

```
Synchronization Requested

↓

Prepare Work Queue

↓

Execute Work Items

↓

Verify Results

↓

Advance Cursor

↓

Synchronization Complete
```

---

# 7. Work Queue

Synchronization SHALL operate on Work Items.

Examples include:

- Upload Object
- Download Object
- Upload Event Segment
- Download Event Segment
- Refresh Wrapped Keys
- Update Device Registry

Work Items MAY execute in parallel where ordering permits.

---

# 8. Synchronization Triggers

Synchronization MAY submit a Synchronization Job because of:

- user request
- scheduled interval
- Bundle creation
- network availability
- application startup
- remote notification

Implementations MAY define additional triggers.

---

# 9. Sessions

A Synchronization Session represents communication with a remote replica.

Sessions MAY contain multiple synchronization cycles.

---

# 10. Cycles

A Synchronization Cycle performs one reconciliation pass.

Each Cycle SHALL produce one of:

- converged
- partially converged
- interrupted

---

# 11. Checkpointing

Synchronization checkpoints SHALL be persisted through the Runtime Job Framework.

Checkpoints include:

- completed Work Items
- synchronization cursor
- pending retries

Interrupted synchronization SHALL resume from the latest checkpoint.

---

# 12. Retry

Retry SHALL occur only for retryable failures and SHALL be scheduled by the Runtime Job Framework.

Retry policy MAY include:

- exponential backoff
- jitter
- server guidance

Permanent failures SHALL not be retried automatically.

---

# 13. Conflict Model

Because Bundles are immutable and Events are append-only, synchronization conflicts SHOULD be rare.

Conflicts MAY occur in:

- concurrent projection updates
- key rotation timing
- device enrollment races

Conflict resolution is defined by the Event model.

---

# 14. Background Synchronization

Synchronization MAY execute in the background.

Background work SHALL:

- respect platform constraints
- survive temporary interruptions
- avoid blocking foreground operations

---

# 15. Bandwidth Management

Implementations MAY:

- batch transfers
- compress payloads
- prioritize small objects
- defer large uploads
- pause synchronization on metered connections

Policy is implementation-defined.

---

# 16. Integrity Verification

Downloaded Objects SHALL be verified before acceptance.

Objects failing verification SHALL be rejected.

---

# 17. Recovery

Following interruption, the Synchronization Service SHALL:

- restore checkpoint
- rebuild pending Work Queue
- continue reconciliation

No completed Work Item shall execute twice unless it is explicitly idempotent.

---

# 18. Diagnostics

The Synchronization Service SHOULD expose:

- current status
- active session
- active cycle
- pending work count
- transfer statistics
- retry count

Diagnostics MUST NOT expose decrypted content.

---

# 19. Invariants

Synchronization reconciles replicas.

Synchronization is resumable.

Synchronization execution is a Runtime Job.

Synchronization is idempotent at the protocol level.

Objects are verified before persistence.

The local Vault remains usable while synchronization is in progress.

---

# 20. Vault Generation Fencing

Handshake, submission, and cursor records SHALL carry the opaque active generation number and generation root ID. These fields are accepted coordination metadata leakage; the Service still cannot inspect the encrypted manifest or capture graph.

Generation activation uses compare-and-swap. Authoritative submissions naming a superseded generation SHALL fail with `VAULT_GENERATION_SUPERSEDED` and MUST NOT resurrect omitted Objects. A stale replica without unpublished authoritative work resets to the active generation. A stale replica with unpublished work is quarantined for explicit recovery or Import and MUST NOT merge automatically or be deleted silently.

---

# References

protocol/protocol.md

runtime/runtime.md

runtime/storage.md

vault/vault.md
