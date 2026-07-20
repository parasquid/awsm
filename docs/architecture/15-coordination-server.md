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

An Account authenticates with a normalized email and a client-derived authentication secret; the
server never receives the password. Signup has no email verification or delivery. Rotating opaque
access and refresh credentials are digest-only at rest, and reuse of a consumed refresh credential
revokes its logical session. Each Account owns at most one Vault replica record. That record stores
one opaque Account-wrapped Vault slot and exactly one active Generation.

An empty Account may attach a Vault at its current nonnegative Generation number. The Coordination
Server preserves that supplied identity and number as the Replica's first known active Generation;
it does not renumber the Generation, synthesize predecessor rows, or infer ancestry from encrypted
Generation contents.

The server does not authorize Devices or possess the Account Encryption Key, Vault Root Key, or
device-local slot. Shared Vaults, roles, invitations, Device signing/revocation, billing, quotas,
password change, and Account Recovery Keys remain outside the current boundary. The black-box proof
uses the same public Account/session resources as the extension; `AWSM_SYNC_PROOF` selects test
adapters only and never changes authentication semantics.

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
  always sufficient. A 60-second, digest-only, Account-bound Cable ticket is atomically consumed
  once and scrubbed from retained request URL state.
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

# Scaling and Remaining Production Gate

The current deployment uses PostgreSQL, Disk storage, and process-local or database-backed adapters.
Horizontal Rails replicas require a shared immutable-byte Driver and shared Cable/Job
infrastructure. Production promotion still requires Device/recovery authorization, quotas and abuse
controls, operational backup/restore, independent security review, and deployment-specific
hardening. Redis-backed ephemeral Cable tickets and a Redis Action Cable adapter remain Roadmap
candidates, not current dependencies.
