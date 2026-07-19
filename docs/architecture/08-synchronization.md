# Synchronization Architecture

**Document:** `architecture/08-synchronization.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/00-design-principles.md
- architecture/glossary.md
- specifications/protocol/protocol.md
- specifications/event/event-format.md

---

# Purpose

Synchronization makes independently operating trusted client Replicas converge on opaque
authoritative Vault history through an untrusted Coordination Server.

# Authority

Clients own encryption, semantic validation, canonical Event replay, conflict handling, and local
retention. The Coordination Server owns no plaintext and never decides semantic truth. It durably
stores immutable ciphertext, verifies transfer integrity, publishes complete declared Event
closures, maintains operational Generation membership, and exposes delivery discovery.

# Two Orders

Canonical Event replay order is defined by Event metadata and remains independent of transport.
The per-Vault Delivery Cursor is a monotonically increasing acceptance sequence used only to ask
which server changes arrived after a prior observation. A late offline Event may sort earlier for
replay while receiving a later Delivery Cursor. Implementations MUST NOT use cursor order as Event
order.

# Upload and Publication

Clients upload encrypted Objects in resumable parts to an active or candidate Generation scope.
Exact byte length and ciphertext SHA-256 are verified before an Object becomes
`DurableUncommitted`. Invisible durable records become readable only through either:

1. one atomic Event closure commit that publishes the Event and every declared durable dependency;
   or
2. one fenced successor Generation activation that publishes its complete sealed membership.

No incomplete Bundle, Event closure, or Generation is ever visible.

# Pull and Wake-Up

Full active enumeration bootstraps a Replica in lexical Object-ID pages. Incremental changes are
snapshot-bounded by Delivery Cursor. Clients download through scoped tickets, reconstruct ranges,
and independently verify immutable metadata.

Action Cable hints carry only Vault ID and latest cursor. Subscribe-before-fetch, refetch after every
hint, generation-guard reconciliation, coalesce bursts without losing the final wake-up, and poll on
visibility/focus. Correctness MUST survive every hint being lost.

# Generation Reconciliation

Generation zero is explicit. Vault History Rewrite constructs one inactive successor and submits the
complete retained Object-ID set in globally sorted pages. The Service validates existence and
declared Event dependency closure without interpreting encrypted content.

Activation is a compare-and-swap over predecessor Generation ID, predecessor number, and exact
observed head cursor. A concurrent commit forces the client to keep the candidate isolated, refetch,
and deliberately rebuild or reconcile. The Service never silently resets or merges client state.

# Recovery

Superseded Generation membership leaves the active path and remains temporarily available only
through explicit recovery resources. A trusted client downloads it into an isolated recovery or
import workflow. Recovery is not synchronization and never mutates the active head.

# Retry and Isolation

Mutating requests are idempotent within authenticated Account and operation scope. Natural Object,
Event, Vault, and Generation identifiers additionally prevent conflicting reuse. Every query begins
from the authenticated Account's Vault scope. Durable-uncommitted, candidate, superseded, recovery,
and active records MUST NOT leak into one another's read paths.

# Deferred Work

The current server proof does not implement trusted Runtime synchronization, Device authorization,
production Account authentication, shared Vaults, quotas, a shared-storage Driver, retention UI, or
client recovery cryptography. Those boundaries require separate approved work.
