# Coordination Server Architecture

**Document:** `architecture/15-coordination-server.md`

**Status:** Draft

**Owner:** Engineering

**Primary Implementation:** Ruby on Rails

**Depends On:**

- architecture/03-zero-knowledge.md
- architecture/08-synchronization.md
- specifications/protocol/protocol.md
- specifications/protocol/http-api.openapi.yaml

---

# Purpose

The Coordination Server synchronizes opaque encrypted Vault records without possessing plaintext or
unwrapped Vault keys. The trusted Runtime owns semantic validation, Event replay, encryption, and
reconciliation. The server owns only authenticated Account scope, durable opaque transfer,
transactional publication, delivery bookkeeping, advisory wake-up hints, and recovery retention.

# Current Boundary

The implemented proof uses one Account principal that directly owns multiple isolated Vault replica
records. It proves Account isolation but does not claim Device authorization, production login,
shared Vaults, roles, invitations, billing, quotas, or recovery cryptography. Proof authentication is
available only when Rails runs in the test environment with `AWSM_SYNC_PROOF=true`; all other
unconfigured authentication fails closed.

# Server-Visible Metadata Budget

The server may know Account and Vault operational IDs; broad Object type; ciphertext byte length and
SHA-256; encrypted Object ID; Event ordering timestamp; the exact sorted dependency Object IDs
declared for an Event; Vault Generation identity, number, predecessor, full retained membership,
and recovery deadline; upload state; delivery cursor; Job progress; and safe outcome codes.

The server MUST NOT receive plaintext, keys, semantic Event subtype, titles, URLs, notes, tags,
filenames, search terms, content-derived metadata, or plaintext checksums. Complete retained
membership leaks encrypted graph shape and is accepted solely to make remote deletion safe.

# Components

- The HTTP control adapter implements the strict OpenAPI 3.0.3 contract under `/api`.
- Transfer tickets authorize one opaque upload or download scope and are stored only as SHA-256
  digests.
- PostgreSQL stores operational metadata, immutable identity, membership, delivery changes,
  idempotency, and Purge Job checkpoints. It never stores Object payload bytes.
- `OpaqueByteStorage` provides immutable byte operations. The proof Disk Driver uses a private root,
  bounded streams, fsync, and same-filesystem atomic installation.
- Action Cable publishes `{vaultId, latestCursor}` only after a committed head change. Polling is
  always sufficient.
- Solid Queue runs expiry and purge work. A domain Purge Job, not queue state, owns resumability and
  visible progress.

# Publication Model

Uploads become `DurableUncommitted` only after exact length and ciphertext checksum verification.
They remain invisible. One Event closure commit locks its Vault, rechecks the active Generation and
exact dependency declaration, commits the complete durable closure, adds active membership, assigns
one Delivery Cursor, and records one delivery change in the same PostgreSQL transaction.

Generation zero is explicit. A successor is staged as one inactive candidate with paged, globally
sorted reachability. Activation compares predecessor ID, predecessor number, and exact observed head
cursor. It atomically supersedes the predecessor, activates the successor membership, and advances
the Delivery Cursor. An intervening commit makes activation fail without changing either scope.

# Recovery and Deletion

Superseded Generations are accessible only through explicit recovery resources until `purgeAfter`.
The hosted default is 90 days. Manual purge requires recent Account confirmation and snapshots all
currently superseded Generations. Automatic expiry creates the same durable Job.

Purge detaches only targeted memberships, preserves every record referenced by an active, candidate,
or other retained Generation, revokes recovery tickets, verifies byte absence, and finally leaves a
permanent immutable tombstone. Missing committed bytes are integrity incidents, never cleanup hints.

# Scaling and Production Gate

The proof intentionally uses one Rails process, PostgreSQL, Disk storage, an in-process Cable
adapter, and independent Node clients. Horizontal Rails replicas require a shared immutable-byte
Driver and shared Cable/Job infrastructure. Production promotion additionally requires approved
Account authentication, Device/recovery authorization, quotas and abuse controls, operational
backup/restore, security review, and trusted client synchronization.
