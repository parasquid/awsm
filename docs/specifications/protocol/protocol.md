# Archive Synchronization Protocol

**Document:** `specifications/protocol/protocol.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- architecture/glossary.md
- event/event-format.md
- http-api.openapi.yaml

---

# 1. Purpose and Authority

This specification defines transport-independent synchronization sequencing, durability, fencing,
recovery, and retry semantics. `http-api.openapi.yaml` owns the canonical HTTPS methods, paths,
headers, statuses, and JSON shapes. Conflicts are specification defects and SHALL be reconciled in
both documents.

# 2. Canonical Protocol

Before the first release, exactly one strict protocol exists. HTTPS uses unversioned `/api` routes
and requires `Awsm-Protocol-Version: 1`; a missing or different value fails. There is no handshake,
negotiation, alternate message envelope, unknown-field preservation, compatibility reader, or
fallback transport.

# 3. Trust Boundary

The trusted client validates and encrypts authoritative Objects and Events. The untrusted
Coordination Server receives immutable ciphertext plus the minimum opaque metadata needed for
transfer, dependency closure, ordering discovery, Generation fencing, and safe retention. It never
interprets plaintext or commands client eviction.

# 4. Opaque Upload

When an Account without a Vault attaches its first Replica, the client supplies the Vault's current
active Generation identity and any nonnegative Generation number. The Service records that exact
Generation as its first known active Generation with no server-side predecessor, even when the
authenticated encrypted Generation Object names earlier history. Attachment does not renumber the
Generation, infer missing predecessor rows, or interpret its encrypted contents.

The client begins an upload with immutable identity, broad Object type, exact byte length,
ciphertext SHA-256, and target Generation. Events additionally declare their canonical ordering
timestamp and lexically sorted unique dependency Object IDs. Dependencies must already exist in an
eligible upload or durable scope; placeholder records are prohibited.

Parts use short-lived scoped tickets. Repeated identical parts succeed and conflicting parts fail.
Finalization streams every part in order, verifies whole-Object length and checksum, durably installs
the immutable bytes, then records `DurableUncommitted`. This state is invisible to all read paths.

# 5. Event Closure Publication

One commit names one finalized Event, its exact bound dependency list, and the active Generation ID
and number. Under a Vault lock, the Service requires the entire closure to be durable and eligible.
It atomically commits newly introduced records, records active membership, persists one Event commit,
assigns one per-Vault Delivery Cursor, and records one `EventCommitted` delivery change.

If the immutable Event and exact dependency closure are already committed and are all members of
the requested active Generation, the commit is an idempotent acknowledgement. This includes a
closure retained into a successor Generation: the Service does not create another Event commit,
advance the Delivery Cursor, or reject the request merely because the original commit named the
predecessor Generation. A changed dependency declaration or a closure absent from the active
Generation still conflicts.

The Delivery Cursor orders acceptance for incremental discovery only. Canonical Event replay order
continues to come from the Event specification. A late Event with an older ordering timestamp still
receives the next Delivery Cursor and remains discoverable.

# 6. Replica Reads

Active enumeration pages the complete active Generation membership in lexical Object-ID order.
Change paging captures a snapshot cursor and returns only changes after the requested cursor and no
later than that snapshot. Downloads require active membership and a scoped ticket; clients verify
the reconstructed ciphertext length and SHA-256 before accepting it.

Action Cable sends only a Vault ID and latest cursor as an advisory wake-up. A receiver refetches
canonical changes. Duplicate, delayed, or absent hints do not affect correctness.

# 7. Generation Compare-and-Swap

Generation zero is explicit. One successor candidate may exist per Vault. The candidate declares the
active predecessor, exact observed head cursor, successor number, and encrypted Generation Object.
The client submits the complete retained Object-ID set in globally sorted pages and seals it with
count and SHA-256 commitments. The Service automatically includes the successor Generation Object
and verifies that every retained Event's declared dependencies are retained.

Activation compares predecessor ID, predecessor number, and head cursor under the Vault lock. It
atomically commits candidate records, installs successor membership, supersedes the predecessor,
advances the head, and records `GenerationActivated`. Any intervening active commit fails the CAS.
A superseded Generation cannot accept writes or reactivate.

# 8. Recovery and Purge

Superseded Generation membership remains available only through explicit recovery resources until
its deadline. Recovery never changes active state or performs a server-side merge.

A durable Purge Job snapshots targeted superseded Generations, makes them unavailable for new
recovery transfers, detaches their memberships, and deletes only records unreferenced by every
remaining active, candidate, or retained Generation. Success requires verified byte absence and a
committed permanent tombstone. Jobs resume idempotently after partial failure and cannot be
cancelled after snapshot.

# 9. Idempotency and Outcomes

Every mutating control request carries an idempotency UUID. The Service binds Account, operation,
key, method, canonical path, and exact request-body digest. An identical replay reconstructs the
same logical result with fresh ephemeral tickets; a changed request conflicts. Immutable natural
identifiers provide additional protection but do not replace idempotency.

Failures use stable outcome identifiers and never expose plaintext, credentials, cross-Account
existence, or validation exception text.
