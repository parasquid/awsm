# AWSM Roadmap

This roadmap records unresolved future product initiatives. It is not an implementation history,
architecture specification, or authorization to build. Decision-complete work requires an approved
numbered plan and reconciliation with the owning specifications.

## Initiative Statuses

- **Discovery:** the problem, feasibility, or major architectural choices remain open.
- **Candidate:** the direction is coherent, but scope, dependencies, or acceptance criteria remain
  open.
- **Approved:** explicitly approved for conversion into a numbered implementation plan.

---

## Zero-Knowledge Synchronized Web Client

**Status:** Candidate

**Potential product surface:** a configurable production web origin, currently referred to as
`awsm.foo`

**Canonical foundations:** [system boundaries](docs/architecture/01-system-overview.md),
[Bundle and Artifact contracts](docs/specifications/bundle/bundle.md), and
[Vault Package interchange](docs/specifications/portability/import-export.md)

### Candidate Boundaries

Every capability in this initiative is optional future work. A separately approved narrow
Coordination Server proof would not approve, schedule, or require the broader product surface.
Each deferred area requires its own explicit promotion before it may become an implementation plan:

- **Candidate — Account and recovery:** production login, Account-key enrollment, recovery
  cryptography, password change, and recovery user experience;
- **Candidate — Device trust:** cryptographic Device identity, signed requests, enrollment,
  revocation, key distribution, and Device management;
- **Candidate — Production operations:** quotas, abuse controls, shared object-storage adapters,
  billing, and production deployment hardening;
- **Candidate — Client synchronization:** extension integration, retention controls, background
  synchronization, and selective local Replica behavior; and
- **Candidate — Web product surface:** a web Library, recovery and management interfaces, Search,
  organization, Export and Import workflows, collaboration, and other product UI.

Listing a Candidate records an avenue worth evaluating. It does not assert that the capability will
be implemented, establish delivery order, or reserve it for a release.

### Future Product Delta

Build on the implemented untrusted Coordination Server proof with an independent trusted web client
and production security boundary that add:

- Accounts and authenticated sessions without granting content-decryption authority;
- client-only Account key enrollment, recovery, password change, and device-slot ceremonies;
- trusted-client synchronization of opaque authoritative Objects, Events, future key wrappers, and
  the implemented Vault Generation fences;
- zero-knowledge Account storage quotas and usage visibility over opaque bytes;
- Full and Selective local Replica retention profiles with explicit per-Artifact availability;
- background upload, durable server acknowledgement, on-demand Artifact retrieval, and safe local
  eviction;
- a web Host for Library browsing, local Search, organization, Vault management, Export, recovery,
  and Device management; and
- selective Import plus server-backed retrieval that can turn a Selective local Replica into a
  standalone Complete Export.

Capture remains extension-only for the first web-client scope. The web client must not bridge into
extension-local storage or receive plaintext from another client outside the specified encrypted
synchronization protocol.

### Candidate Shape

Evaluate a shared platform-independent Runtime used by the extension and web Hosts. The implemented
Rails/PostgreSQL/Disk proof establishes the strict Account-scoped Coordination API and opaque byte
semantics, but does not select a production Account/UI shell or shared object-storage adapter.

The Coordination Server would be a zero-knowledge Full Replica after durable synchronization. This
describes ciphertext completeness, not semantic authority. A client-created dependency closure must
be durable before its Event becomes visible remotely, and newly created local content must not be
evicted before that acknowledgement.

### Account and Recovery Questions

Resolve and specify:

- Account authentication methods: verified email/password, WebAuthn passkeys, email magic links, or
  a narrower subset;
- whether an Account login password is always distinct from the client-only Account Master
  Password;
- the Account Encryption Key hierarchy, authenticated wrappers, KDF parameters, and independent
  security review;
- Account Recovery Key creation, display, rotation, loss, and replacement ceremonies;
- recovery when all enrolled browsers are lost, and explicit unrecoverability when neither Master
  Password nor Recovery Key remains;
- Device/session revocation semantics given that offline replicas and previously obtained keys
  cannot be remotely erased; and
- reassociation of a locally imported Vault with an existing Account.

### Synchronization and Retention Questions

Resolve and specify:

- Account quota scope, byte accounting, upload reservation, concurrent transfer behavior,
  superseded-generation charging, over-quota outcomes, and self-hosted configuration;
- whether production use accepts the proof's documented server-visible metadata budget and
  traffic-analysis consequences;
- retention profiles, default cache budgets, pinning, eviction order, offline promises, and user
  warnings when the server holds the only complete ciphertext copy;
- recovery for stale replicas with unpublished work after a Vault Generation is superseded;
- how per-Artifact local, uploading, remotely durable, fetching, and unavailable states are stored
  operationally without becoming authoritative Vault history;
- how a user intentionally discards the final known copy of content, if that is permitted at all;
  and
- how selective Import represents authenticated omissions without treating corruption as
  unavailability.

### Web Client Questions

Resolve and specify:

- first-release routes and whether the Library shell is server-rendered or fully static;
- browser support, storage quotas, idle locking, background lifecycle limits, and accessibility;
- offline bootstrap and Account-key recovery after browser storage is cleared;
- how local Search Projection Materializations rebuild from retained source Artifacts;
- how on-demand MHTML and screenshots are viewed or downloaded without server plaintext; and
- whether self-hosted deployments may use a configurable origin without weakening WebAuthn,
  cookie, CSP, CSRF, or key-wrapper boundaries.

### Possible Delivery Sequence

If one or more of these Candidates are separately approved, an illustrative dependency order is:

1. Specify Account, recovery, Device, trusted-client synchronization, selective availability, and threat contracts;
   complete independent security review.
2. Implement the trusted local synchronization engine against the existing opaque Coordination API
   with deterministic multi-replica tests and fault injection.
3. Implement Account enrollment/recovery and a read-only web Library over a Selective Replica.
4. Add web organization, Search, Export retrieval, selective Import, retention controls, and Device
   management only after earlier invariants hold.

### Evidence Required Before Promotion

- cryptographic vectors and independent review for Account/recovery wrappers;
- multi-client tests for offline divergence, retries, out-of-order delivery, duplicate delivery,
  generation supersession, and malicious server responses;
- proof that no plaintext, unwrapped keys, Search queries/tokens, or content-derived metadata cross
  the server boundary;
- bounded-memory transfer and quota tests for Artifacts beyond 4 GiB;
- retention tests proving no local eviction before durable remote closure acceptance;
- selective Import/Export tests distinguishing permitted authenticated omission from corruption;
- browser lifecycle, storage-clear, lock, revocation, accessibility, and narrow-layout evidence; and
- an operational threat model covering abuse, denial of service, rollback, replay, traffic analysis,
  backups, logging, and incident response.
