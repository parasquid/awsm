# AWSM Roadmap

This roadmap records possible future product initiatives that are still being explored. A roadmap
entry is not an approved implementation plan, does not supersede architecture or specifications,
and does not authorize implementation. When an initiative becomes decision-complete and receives
explicit approval, create a numbered document in `docs/plans/` and reconcile every affected
authoritative document before implementation.

## Initiative Statuses

- **Discovery:** problem, feasibility, and major architectural choices are still being evaluated.
- **Candidate:** direction is coherent, but scope, dependencies, or acceptance criteria remain open.
- **Approved:** explicitly approved for conversion into a near-term numbered implementation plan.

---

## Zero-Knowledge Synchronized Web Client

**Status:** Candidate
**Potential product surface:** configurable production web origin, currently referred to as
`awsm.foo`
**Promotion target:** a future numbered plan only after the decisions and evidence below are
resolved and explicitly approved

### Product Thesis

Explore an independent trusted web client that maintains an encrypted Selective Replica by default
and synchronizes canonical encrypted Vault records with the browser extension through an untrusted
Coordination Server. The Coordination Server maintains a Full Replica of successfully synchronized
authoritative ciphertext; it may be the only Full Replica unless a client selects Full offline
retention. The web client must not bridge into extension IndexedDB or receive extension-local
plaintext.

The proposed first web client would support browsing, local search, organization, Vault rename,
delete/restore, Export, recovery settings, and Device management. Capture would remain
extension-only.

### Candidate Architecture

```text
Browser Extension                    Web Client
┌──────────────────┐                ┌──────────────────┐
│ Shared Runtime   │                │ Rails UI shell   │
│ Extension Host   │                │ Shared Runtime   │
│ Selective Replica│                │ Web Host         │
│ Encrypted IDB    │                │ Selective Replica│
│ Root Key memory  │                │ Encrypted IDB    │
└────────┬─────────┘                └────────┬─────────┘
         │ encrypted Objects, Events, keys  │
         └──────────────┬───────────────────┘
                        ▼
          Rails Coordination Server
          Full encrypted remote Replica
          PostgreSQL + object storage
          No plaintext or unwrapped keys
```

The recovered proposal suggests:

- a Rails application serving authentication, enrollment, Account and Device pages, the Library
  shell, and the Coordination API;
- PostgreSQL for operational metadata and S3-compatible storage for opaque encrypted payloads,
  with MinIO for local development;
- Rails-rendered shells with strict TypeScript providing all trusted Vault behavior in the browser;
- shared platform-independent Runtime, cryptography, protocol, Projection, and validation packages
  consumed by extension and web Hosts; and
- Host interfaces around storage, navigation, Capture, notifications, and secure-key handling.

These are candidate implementation choices, not approved architectural commitments.

### Authentication, Encryption, and Enrollment Direction

The product direction should distinguish two deliberate operating modes.

- **Local-only:** a user may create and use Vaults in one browser without an Account, server, or
  persistent passphrase. Each Vault Root Key remains wrapped only by that browser's non-exportable
  device key. Export/Import provides manual transfer, not continuous synchronization or
  Backup/Restore. Only a complete Vault Package is standalone; a Selective package may preserve
  explicit unavailable content. Two imported replicas will diverge if both accept later mutations
  without a shared Coordination Server.
- **Account-synchronized:** a user may connect to `awsm.foo` or a configurable self-hosted
  Coordination Server, authenticate an Account, and protect synchronized Vault access with one
  client-only Account Master Password. Another browser signs in to the same Account, supplies the
  Account Master Password once, creates local device slots, and then synchronizes without approval
  from an existing trusted Device.

Account authentication and Vault decryption must remain separate. Account authentication may grant
access only to ciphertext, Device/session metadata, encrypted key wrappers, and synchronization
operations. The Account Master Password, derived keys, Account Encryption Key, unwrapped Vault Root
Keys, recovery secrets, and plaintext verification material must never reach the Coordination
Server.

The proposal asks to evaluate three interchangeable Account authentication methods:

- verified email and a server-hashed password;
- WebAuthn passkeys with strict origin, RP ID, challenge, user-verification, and signature-counter
  validation; and
- random, hash-stored, single-use email magic links expiring after ten minutes.

Candidate session controls include rotated server-side sessions, Secure/HttpOnly/SameSite=Lax
cookies, and CSRF protection for state-changing Rails requests.

The candidate synchronized key hierarchy is:

1. The first client generates one random Account Encryption Key locally.
2. Argon2id derives a wrapping key from the Account Master Password and a random salt; the wrapper
   authenticates the KDF parameters.
3. That wrapping key encrypts the Account Encryption Key in an authenticated, versioned wrapper.
4. The Account Encryption Key independently wraps each opted-in Vault Root Key with authenticated
   Account, Vault, algorithm, and format context.
5. The Coordination Server stores the encrypted Account Encryption Key wrapper, encrypted Vault
   Root Key wrappers, KDF parameters, and permitted coordination metadata.
6. A new browser authenticates the Account, downloads the wrappers, derives and unwraps locally,
   verifies each Root Key, and creates local non-exportable device slots for the Account Encryption
   Key and available Vault Root Keys before synchronization.
7. Subsequent local unlock uses the browser's device slot; the Account Master Password is normally
   required only when connecting a new browser, recovering local key access, or changing it.

Changing the Account Master Password should rewrap only the Account Encryption Key. Adding a Vault
to synchronization should wrap that Vault's independent Root Key under the Account Encryption Key;
it must not re-encrypt authoritative Vault contents. This convenience intentionally makes the
Account Encryption Key a shared access boundary for all opted-in Vaults, even though their Root Keys,
Objects, Events, and identities remain independent.

The Account login password, if password authentication is supported at all, must not silently double
as the Account Master Password. Passkeys or email magic links may provide a more coherent separation:
authenticate the Account, then enter the client-only Account Master Password during first-time setup
on that browser.

#### Recovery Direction

- Synchronization setup should generate a high-entropy Account Recovery Key that can independently
  unwrap the Account Encryption Key through its own authenticated wrapper.
- The user must be told that AWSM and a self-hosted operator cannot recover the Account Master
  Password or decrypt synchronized Vaults.
- A browser that can unlock its local Account Encryption Key may establish a new Account Master
  Password by replacing the encrypted Account Encryption Key wrapper after Account authorization.
- If every locally enrolled browser is lost, full Account recovery requires the Account Master
  Password or Account Recovery Key. Without either, synchronized ciphertext is intentionally
  unrecoverable.
- A valid encrypted Export can still be imported to create its contained Vault locally, but it does
  not recover the Account Encryption Key or other synchronized Vaults. Reassociating that Vault with
  an Account requires an explicit, separately specified recovery flow.
- Rotating or removing a recovery wrapper does not revoke browsers that already obtained Vault Root
  Keys. Device/session revocation similarly stops future server access but cannot erase an offline
  replica or cryptographic material it already received.

The exact KDF, wrapping envelopes, recovery representation, verification mechanism, and Master
Password change/recovery ceremonies require dedicated specifications, cryptographic vectors, and
independent security review before production use.

### Synchronization and Local Replica Direction

This candidate uses the following terms. They remain roadmap terminology until the initiative is
approved and the glossary and owning specifications are reconciled.

- A **Full Replica** retains the complete active authoritative Vault graph.
- A **Selective Replica** participates in synchronization while retaining only the authoritative
  content selected by its local retention policy.

The Coordination Server is a zero-knowledge Full Replica after successful synchronization. This
describes completeness of stored ciphertext, not semantic authority: immutable authoritative
Objects and Events remain the source of Vault truth, and the server never interprets, creates,
merges, or searches them. A client must retain newly created authoritative content until the server
has durably accepted every referenced Object and Event and the applicable Vault Generation fence.
An upload attempt, temporary staging record, or notification is not sufficient proof for local
eviction.

The candidate replaces the single encrypted Bundle ZIP with a complete immutable Bundle graph. A
compact encrypted descriptor contains the Manifest, metadata, and references to independently
encrypted Artifact Objects. The initial web-page graph contains mandatory `PRIMARY` MHTML and may
contain `SCREENSHOT_FULL`, `TEXT_EXTRACTED`, and `THUMBNAIL` Artifacts. Artifact remains the
canonical term; “attachment” is only an analogy for on-demand transfer behavior.

Account-synchronized clients upload the descriptor and every referenced Artifact automatically in
the background. An offline synchronized client retains its complete local Capture and resumes after
reconnection. Connecting a local-only Vault schedules a complete backfill. The server makes
`BundleRegistered` visible only after the complete dependency closure is durable and verified;
other clients never observe a remotely incomplete Bundle.

Synchronized clients expose three explicit local retention profiles:

- **Full offline:** retain the complete active authoritative Vault graph and local rebuildable
  Materializations. Complete browse, read, and search remain available without the server.
- **Recent content:** retain descriptors, encrypted metadata, `TEXT_EXTRACTED` and `THUMBNAIL`
  Artifacts, pending local work, pinned Artifacts, and a bounded cache of recent MHTML and full
  screenshots. This is the default for new web clients and browser extensions.
- **Capture-only:** retain local key slots, minimum synchronization state, and authoritative
  Captures until durable synchronization completes. Library browsing and search are unavailable
  until the profile changes.

Changing profiles is local operational policy and never creates a Vault Event. Local eviction is
not Vault deletion, Vault Vacuum, Secure Scrub, Backup retention, or remote garbage collection.
When the server is the only Full Replica, uncached content depends on server availability; the UI
must state that consequence rather than presenting Selective Replica behavior as complete offline
availability.

A Selective Replica holding an authenticated Bundle descriptor but only some referenced Artifact
payloads has not committed an incomplete Bundle. Availability is tracked per referenced Artifact:
local, pending upload, remotely durable, fetching, or unavailable. Unavailable means a validated
Selective Vault Package intentionally omitted the payload, or the user explicitly discarded the
only known available copy after a warning. A payload claimed as present but missing, corrupt,
truncated, or unverifiable is a failure, never an unavailable state.

The candidate design must preserve these invariants:

- The Coordination Server stores and transfers opaque encrypted Vault records only; it never
  receives plaintext Vault data.
- Server-visible coordination metadata is limited to identifiers, Device IDs, ordering/fencing
  values, sizes, checksums, and ciphertext required by the protocol.
- Immutable encrypted Objects upload before Events that reference them.
- Vault Generation activation uses an opaque generation/root compare-and-swap fence.
- Clients download Events deterministically, fetch Objects required by their retention profile or
  an on-demand operation, authenticate locally, commit atomically, and rebuild Projections locally.
- Each client owns an independent cursor and retries interrupted work idempotently.
- Notifications contain only non-content synchronization hints and cause clients to fetch canonical
  records.
- Projections, Materializations, Workspace active-Vault selection, local name caches, Jobs,
  diagnostics, and decrypted metadata never synchronize.
- Authoritative Vault-name and Collection Events, Vault Generations, encrypted Objects,
  Account/Vault key wrappers, recovery wrappers, and the minimum Device/session records needed for
  authorization and revocation may synchronize.

Recent and Full Replicas synchronize encrypted metadata and `TEXT_EXTRACTED` Artifacts, then build
their own Search Projection Materializations locally. Search never executes on the server, and
queries, deterministic term tokens, result identifiers, plaintext index data, and Projection keys
never cross the trusted-client boundary. `TEXT_EXTRACTED` and `THUMBNAIL` are immutable Derived
Artifact Objects included in Vault Generations, Backup, and Export; the Search Projection built from
them remains disposable and unsynchronized. Failure to generate either optional Artifact never
invalidates mandatory MHTML preservation, but the client must disclose reduced search or preview
coverage.

The proposed web Selective Replica would:

- use a dedicated IndexedDB database with canonical Vault-prefix isolation;
- persist ciphertext, Events, Generations, descriptors, compact synchronized Artifacts, cursors,
  non-exportable Device keys, local key slots, and rebuildable encrypted caches;
- retain decrypted content and unwrapped Root Keys in memory only;
- support offline unlock and operations over locally retained content after initial Account-key
  unlock and synchronization;
- build and search its local Search Projection from synchronized source Artifacts and fetch MHTML or
  full screenshots independently on demand when online;
- reconcile queued work through deterministic Event replay after connectivity returns;
- lock on explicit action, idle timeout, sign-out, Device revocation, or loss of key access; and
- treat browser-storage clearing as local key loss requiring Account authentication plus the Account
  Master Password or Account Recovery Key before full synchronization can resume; Import may recover
  only the Vault contained by that Export.

#### Selective Export and Import Direction

The candidate uses one passphrase-protected ZIP64 `.awsm` format with authenticated coverage
metadata. Export includes the active Generation, head, Events, Bundle descriptors, metadata,
`TEXT_EXTRACTED` and `THUMBNAIL` Artifacts, and every MHTML or full screenshot currently stored
locally. Each referenced heavyweight Artifact omitted from the package receives an authenticated
omission descriptor containing its Object identity, expected stored-wrapper byte length, and
ciphertext integrity information. Plaintext Artifact checksums and Roles remain inside the encrypted
Bundle descriptor. Package coverage is complete when nothing is omitted and selective otherwise.

Export defaults to the local subset. A `Download all content` option fetches every omitted Artifact
from the Coordination Server and produces a standalone complete package in the same format. Local
and fetched Objects stream directly into ZIP64 temporary storage; Export never buffers the Vault or
a large Artifact in memory.

Import verifies the compact core, every present Object, and every declared omission before writing
destination state. A Selective package may import without server access; omitted Artifacts become
unavailable and the Library must show that state instead of corruption or a false successful open.
Included MHTML and screenshots are copied into local storage and retained as recent content. An
imported Artifact that is the only known available copy is not automatically evicted; explicit
eviction requires a data-availability warning. If the Vault later connects to a server holding the
exact omitted Object, normal authenticated retrieval makes it available. Re-export includes every
Artifact acquired since Import and preserves omission descriptors for those still unavailable.

Only a complete package is standalone archival portability. A selective package preserves the
Vault catalog, local search sources, previews, and included content, but may contain Captures whose
preserved representation is unavailable.

### Candidate Web Product

The server-rendered surface may provide Account creation, login methods, session management,
synchronization setup, recovery settings, Device/session listing, and revocation.

The trusted browser Runtime may provide:

- Vault selection, unlock, and lock;
- Library browsing, local search, and Collection organization;
- rename, delete/restore, Export, and supported Vault Vacuum controls;
- recovery and Device-management interactions; and
- live reconciliation after synchronization, lock/unlock, revocation, recovery changes, or local
  mutations.

Multiple Vaults retain independent Root Keys and identities, while the Account Encryption Key grants
convenient access to every Vault explicitly opted into that Account. A web client may retain
multiple encrypted Selective Replicas but may keep only the active Vault Root Key unlocked. Locked
Vault names come only from a local encrypted rebuildable cache; a newly connected client displays
neutral ID-based placeholders until each Vault is locally unlocked and its cache rebuilt. Web
mutations use the same Commands, Events, validation, atomicity, and stale-context protection as the
extension. Export decrypts locally. Capture permissions and Capture controls do not appear in the
web client.

### Delivery and Threat Direction

Any future implementation must evaluate and specify:

- HTTPS-only delivery from the configured canonical origin;
- no third-party executable scripts, tag managers, remote modules, or runtime-downloaded code;
- a restrictive CSP with reviewed self-hosted immutable assets, nonce-controlled inline behavior,
  no object embedding, restricted connections, and strict frame ancestry;
- hashed assets, dependency lockfiles, reproducible builds, secret scanning, and reviewed deployment
  artifacts;
- a service worker that caches only the reviewed app shell and never plaintext API responses;
- diagnostics and logs that exclude request bodies, ciphertext, keys, the Account Master Password,
  recovery secrets, Export passphrases, decrypted metadata, and content-derived values; and
- explicit documentation that delivered web JavaScript is inside the trusted-client boundary and
  can expose unlocked Vault contents if compromised.

### Possible Delivery Stages

If promoted into an approved plan, the initiative is expected to decompose into independently
reviewable stages rather than one implementation task:

1. Reconcile web-application, synchronization, trust, cryptography, protocol, storage, testing,
   deployment, PRD, and glossary decisions.
2. Extract shared strict-TypeScript Runtime packages without regressing the extension.
3. Establish the Rails application, operational storage adapters, Account authentication, sessions,
   and delivery-security baseline.
4. Specify and prove the Account Encryption Key hierarchy, Master Password and Recovery Key
   wrappers, local device slots, verification, password change, recovery, and revocation boundaries
   with cryptographic vectors.
5. Specify and prove independently encrypted Artifact Objects, Bundle dependency closure,
   Coordination API persistence, fencing, cursors, notifications, idempotency, quotas, and
   zero-knowledge logging.
6. Add extension Account connection, Master Password setup/unlock, synchronization, recovery, and
   Device/session management.
7. Establish the persistent web Selective Replica, offline shell, lock lifecycle, retention-profile
   transitions, replay, Projection rebuild, and synchronization.
8. Build the Account/synchronization shells and trusted Vault, Library, search, organization,
   Selective/Complete Export, Selective Import, unavailable-content, recovery, and
   Device/session-management UI.
9. Complete cryptographic and security review, failure injection, convergence testing, rendered
   visual inspection, and deployment verification.

Every promoted implementation task must follow RED–GREEN–REFACTOR TDD and the repository's
pre-release policy. No migration, fallback, alternate reader, dual format, or protocol negotiation
may be introduced without explicit user authorization.

### Evidence Required Before Promotion

- Shared cryptographic vectors proving extension/web interoperability for envelopes, derivation,
  Events, Generations, Account/Vault wrappers, recovery wrappers, local device slots, and Root Key
  verification.
- Server threat analysis covering tenant and Vault isolation, strict schemas, authorization,
  session rotation, CSRF, authentication methods, encrypted-key substitution, offline Master
  Password attacks, recovery abuse, revocation limits, idempotency, Generation fencing, quotas, and
  absence of plaintext.
- Cross-client prototypes proving extension Capture to encrypted upload to local web unlock/render,
  and web mutation back to deterministic extension convergence.
- Cross-browser prototypes proving Account authentication plus a client-only Account Master
  Password can unlock synchronized Vaults without trusted Device approval, persist new local device
  slots, change the Master Password without re-encrypting Vault contents, and recover with the
  Account Recovery Key.
- Offline prototypes covering cached unlock, browse/search, queued mutations, reconnect,
  interrupted-transfer recovery, and deterministic convergence.
- Retention prototypes proving Full offline, Recent content, and Capture-only transitions; bounded
  storage across multiple browsers; pinning; independent on-demand Artifact retrieval; and
  preservation of pending authoritative content until durable remote acceptance.
- Bundle-graph prototypes proving atomic local Capture, independently encrypted Artifact Objects,
  remote dependency closure before Event visibility, resumable streaming, and rejection of missing,
  corrupt, truncated, substituted, or cross-Vault Artifacts.
- Search prototypes proving complete local search from synchronized metadata and `TEXT_EXTRACTED`
  Artifacts without MHTML or full-screenshot downloads, plus explicit reduced coverage when an
  optional search-source Artifact does not exist.
- Selective-portability prototypes proving authenticated present/omitted inventories, offline
  Selective Import, unavailable-content rendering, retention of imported heavy Artifacts, re-export
  after on-demand retrieval, and `Download all content` production of a standalone package beyond
  4 GiB without whole-Vault buffering.
- Network, package, persistence, and server-storage audits proving search terms, deterministic term
  tokens, result identifiers, plaintext indexes, decrypted metadata, and keys never cross the
  trusted-client boundary.
- Server-outage prototypes demonstrating the exact capabilities of each retention profile without
  claiming that a Selective Replica provides complete offline Vault access.
- Security validation for malformed protocol fields, cross-Vault IDs, tampered or substituted key
  wrappers, wrong Master Passwords and Recovery Keys, stale or revoked sessions, offline revoked
  Devices, XSS payloads, CSP, and log redaction.
- Rendered inspection of local-only onboarding, Account connection, Master Password setup/unlock,
  locked/unlocked Library, synchronization, offline, empty, loading, error, conflict, recovery,
  Device/session management, retention profiles, unavailable content, Selective/Complete Export,
  Selective Import, coverage warnings, desktop, and narrow states.
- A proposed release gate covering shared packages, extension, Rails, integration, typecheck, lint,
  builds, packaged extension E2E, web E2E, security checks, and `git diff --check`.

### Open Decisions

The following must remain open until researched and explicitly approved:

- whether Rails and the Coordination API should begin as one deployable application;
- whether Rails-rendered shells plus shared TypeScript are the correct web composition;
- which Account authentication methods belong in the first deliverable;
- the exact Account Encryption Key hierarchy, Argon2id parameters, authenticated wrapping
  algorithms, canonical formats, and Root Key verification mechanism;
- Account Master Password strength guidance, change/reset ceremony, memory lifetime, and defenses
  against offline attacks on stolen wrappers;
- the Account Recovery Key representation, storage guidance, rotation, recovery ceremony, and abuse
  controls;
- whether synchronized access should always cover every Account Vault or remain explicit per Vault,
  and how clearly the shared Account Encryption Key risk should be communicated;
- synchronization record shapes, fencing, cursor, notification, quota, and conflict contracts;
- Recent-content storage budgets, pinning rules, eviction ordering, browser quota handling, and the
  durable remote receipt that authorizes local eviction;
- Bundle descriptor and Artifact Object record shapes, opaque dependency-closure commit, streaming
  transfer, server retention, and Vault Vacuum garbage collection;
- the canonical Selective Vault Package coverage and omission records, unavailable-Artifact
  recovery interactions, and warnings for explicitly discarding the last known available copy;
- offline mutation scope and Device-revocation behavior while disconnected;
- browser key-storage guarantees and supported browser/platform matrix;
- which Library, search, organization, Vacuum, Export, recovery, and Device-management capabilities
  constitute the first web milestone;
- the production origin and deployment topology; and
- the security-review and operational-readiness bar required before public use.

### Current Assumptions to Validate

- The production origin is configurable rather than hard-coded to `awsm.foo`.
- The Coordination Server retains a Full Replica of successfully synchronized authoritative
  ciphertext and may be the only Full Replica.
- Trusted browsers persist non-exportable keys and default to Recent-content Selective Replicas;
  users may select Full offline or Capture-only retention.
- Recent and Full Replicas synchronize encrypted metadata, `TEXT_EXTRACTED`, and `THUMBNAIL`
  Artifact Objects and always build and query Search Projection Materializations locally.
- MHTML and full screenshots upload automatically to synchronized Full Replicas but download to
  Selective Replicas only on demand, by pinning, through Import, or for complete Export.
- Export defaults to locally available content, records authenticated omissions, and offers a
  complete download; Selective Import may create explicit unavailable Artifact state offline.
- Local-only use requires no Account or persistent Vault passphrase.
- Account synchronization uses one client-only Account Master Password and does not require approval
  from an existing trusted Device.
- Export/Import remains manual transfer rather than continuous synchronization or Backup/Restore;
  only complete package coverage promises standalone archival portability.
- Capture remains extension-only.
- No direct website-to-extension Vault-data bridge is introduced.

### Candidate Deviations From Current Normative Documentation

This Candidate does not supersede the current normative architecture or specifications. Promotion
requires explicit approval and an in-place pre-release reconciliation of every affected source.
Known conflicts include the current definition of a Replica as necessarily complete, the guarantee
of complete offline archive behavior without degradation, the statement that the local Vault
remains authoritative, the single-ZIP physical Bundle format, the complete-only Vault Package, and
the rule that every imported Bundle payload must already be locally present.

The required reconciliation spans the design principles and glossary; Vision and README product
promises; Bundle, Artifact, Vault, Object Store, Runtime Synchronization, Runtime Search,
Import/Export, Backup, Restore, and protocol specifications; system, storage, synchronization,
Coordination Server, Projection, security, deployment, and testing architecture; and repository
policy text and tests governing Bundle completeness and portability. Because the project is
pre-release, approval replaces those rules with one canonical model and introduces no compatibility
path, alternate reader, or legacy terminology.
