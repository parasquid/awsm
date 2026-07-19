# Deployment and Operations

**Document:** `architecture/20-deployment-and-operations.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/03-zero-knowledge.md
- architecture/15-coordination-server.md
- architecture/19-testing-strategy.md

---

# Current Proof Topology

`compose.sync-proof.yml` creates an explicitly named isolated project containing PostgreSQL 17, one
Rails test/proof process, a private Disk byte volume, and an independent pinned Node 24 client. The
Rails process uses in-process Action Cable and Job adapters so actual WebSocket and asynchronous
purge behavior cross the same process boundary. Proof volumes never reuse development data.

Run and remove the proof only with:

```bash
docker compose -f compose.sync-proof.yml up --build --abort-on-container-exit --exit-code-from replica-proof
docker compose -f compose.sync-proof.yml down --volumes --remove-orphans
```

The fixed credential in that isolated file is test-only and activates only when Rails runs in the
test environment with `AWSM_SYNC_PROOF=true`. Development and production accept no proof credential.

# Storage

PostgreSQL stores Account/Vault scope, opaque immutable metadata, upload state, Generation
membership, Delivery Cursors, idempotency, and Purge Job checkpoints. It MUST NOT store Object
payload bytes. The proof Disk Driver stores ciphertext under a configured non-public root with
least-privilege files, bounded buffers, fsync, atomic rename, range reads, and verified deletion.

A multi-process or multi-host deployment requires an approved shared immutable-byte Driver and
shared Cable/Job infrastructure. Disk is not horizontally shared. Provider-specific adapters are
not present in the proof.

# Health and Integrity

`/up` is liveness. `/ready` verifies PostgreSQL and write/delete access to the configured private
storage root without reading Vault content. A committed byte that is absent or corrupt is an
integrity incident: readiness and reads fail safely, metadata remains intact, and operators receive
only allowlisted operational context.

# Jobs and Retention

Hosted recovery defaults to 90 days and self-hosted values are validated at boot and advertised.
A recurring dispatcher creates automatic Purge Jobs for expired superseded Generations. Manual and
automatic deletion use the same durable stages and resume from domain checkpoints; queue state is
not the user-visible source of truth. Operators MUST monitor failed-retryable Jobs and storage
integrity without logging membership lists or ciphertext identifiers by default.

# Logging and Secrets

Normal logs may contain request ID, internal operational row IDs, operation, stable outcome, broad
Object type, counters, duration, and retry count. They MUST NOT contain bearer credentials, transfer
tickets, Cable credentials, request/response bodies, ciphertext, storage paths, plaintext-derived
metadata, keys, or full recovery memberships. Parameter filtering covers authorization, credential,
token, ticket, secret, and key names.

# Backup and Restore

Operational backup must capture PostgreSQL and immutable-byte storage at a mutually consistent
boundary and preserve the distinction between active, recovery, and tombstoned records. It is not a
Vault Backup and cannot produce plaintext. Restoring operational infrastructure does not authorize
resurrection of purged tombstones or reuse of discarded pre-release formats.

# Production Gate

Production promotion requires real Account authentication, Device/recovery authorization, quotas
and abuse controls, a shared storage Driver, recurring Job deployment, shared notifications,
backup/restore exercises, alerting, incident response, metadata/traffic analysis, and independent
security review. No product UI or administration surface is supplied by the proof.
