# Import and Export Specification

**Document:** `specifications/portability/import-export.md`

**Version:** 1.0

**Status:** Draft

**Depends On:** `../storage/object-store.md`, `../crypto/crypto.md`, `../vault/vault.md`,
`../runtime/jobs.md`, `../bundle/bundle.md`

---

# 1. Purpose

This specification defines the canonical portable Vault Package. Export is manual interchange; it
is not Backup, synchronization, or persistent Vault recovery configuration. A package is protected
by a user-supplied export passphrase that is never saved and never changes local Vault unlock.

# 2. Container and Layout

The sole canonical format is a streaming STORE-only ZIP64 `.awsm` package with media type
`application/vnd.awsm.vault+zip`, export format version 1, canonical-CBOR records, lexical paths,
fixed DOS epoch timestamps, and no comments, directory entries, platform permissions, duplicate
paths, or compression. ZIP64 SHALL be used for every entry and central-directory record, including
small packages, so entries and packages greater than 4 GiB are valid.

Only these paths are permitted:

```text
key.cbor
manifest.cbor
generation.cbor
head.cbor
events/<event-id>.cbor
objects/<object-id>.cbor
artifacts/<artifact-object-id>.bin
```

Writers SHALL stream through temporary Host storage and SHALL NOT buffer the Vault or any large
Artifact in memory.

# 3. Manifest and Coverage

`manifest.cbor` SHALL contain exactly export format version, package ID, creation time, originating
Vault ID, Generation identity/number, coverage, ordered entry descriptors, ordered omissions, Event
and Object counts, and content integrity.

Coverage is exactly `Complete` or `Selective`. Complete packages have no omissions and inventory
every Artifact wrapper referenced by the authenticated active Vault graph. Selective packages may
omit only referenced `PRIMARY` or `SCREENSHOT_FULL` wrappers. Every omission SHALL authenticate the
Artifact Object ID, expected wrapper byte length, wrapper checksum algorithm, and exact wrapper
checksum. `THUMBNAIL`, `TEXT_EXTRACTED`, and `CONTENT_STRUCTURED` SHALL never be omitted.

Entry descriptors SHALL contain path, record type (`VaultGeneration`, `VaultHead`, `Event`,
`BundleDescriptorObject`, or `ArtifactObject`), record ID, exact byte length, and SHA-256 checksum.
Artifact wrapper entries are inventoried by their Artifact Object record and path. Descriptors and
omissions SHALL be sorted and unique. Content integrity is SHA-256 over canonical CBOR of exactly
`{ entries, omissions, coverage }`.

The Manifest SHALL NOT duplicate Bundle plaintext, Artifact Roles/checksums, Vault names, local
device data, or discarded format fields.

# 4. Export Key Envelope

`key.cbor` SHALL bind package ID, originating Vault ID, exact Manifest checksum, Argon2id parameters,
fresh salt, fresh XChaCha20-Poly1305 nonce, and the encrypted 32-byte Vault Root Key. Argon2id uses 64
MiB memory and three iterations. The passphrase SHALL contain at least 12 Unicode code points and at
most 1,024 UTF-8 bytes.

The package wrapper is independent of local device slots. Passphrase, derived wrapping key, and raw
Root Key remain memory-only and SHALL be wiped after use.

# 5. Authoritative Inventory

Export SHALL capture one authenticated active Vault Generation/head and include the exact reachable
Event and Object records. Bundle Descriptor and Artifact records remain byte-for-byte unchanged.
Complete Export includes every referenced Artifact wrapper unchanged. Selective Export includes
authenticated omissions only as section 3 permits. Deleted Captures remain authoritative until
Vault Vacuum and therefore remain in reachability.

Export SHALL exclude Projections, Materializations, caches, Commands, outcomes, Jobs, temporary
files, diagnostics, local key slots, device keys/metadata, synchronization cursors, and operational
registries.

# 6. Validation

Before download, the same read-only validator intended for Import SHALL:

1. validate ZIP64 structure and exact paths/order/metadata;
2. strictly decode and bind `manifest.cbor` and `key.cbor`;
3. unwrap the Root Key without revealing which authentication field differed;
4. authenticate Generation/head identity and exact Event/Object reachability;
5. replay supported Events and validate every `BundleRegistered` closure;
6. authenticate each Bundle Descriptor and its Artifact references;
7. stream-check every record and wrapper length/checksum;
8. decrypt each included wrapper, validate frame authentication and plaintext reference
   length/checksum, and validate compact structured/text relationships; and
9. prove coverage and omissions are exact, permitted, disjoint, and exhaustive.

Large MHTML and screenshot payloads SHALL never be accumulated during validation. Fixed 16 MiB
allocation limits apply to compact records and compact text/structured validation. Missing, extra,
duplicate, corrupt, unsupported, or cross-Vault content fails closed.

# 7. Snapshot, Cancellation, and Restart

Export runs as a Vault-scoped Job holding an exclusive lease. It captures the active head before
enumeration and compares it again before download. Conflicting mutations return `VAULT_BUSY`.
Export never changes source authoritative bytes.

Cancellation propagates through enumeration, hashing, writing, validation, and download; it removes
the temporary file. Because the passphrase is not persisted, interrupted Jobs fail with
`EXPORT_INTERRUPTED` and never retry automatically.

# 8. Complete Vault Import

The local Runtime SHALL accept only a fully validated Complete package. It SHALL run the same
container, key-envelope, authoritative replay, Bundle-closure, Artifact-stream, and coverage
validator used before Export download. A valid Selective package returns
`SELECTIVE_IMPORT_UNSUPPORTED` only after its omissions and coverage have been authenticated. An
invalid package creates no destination authority or prepared Artifact wrapper.

Import is Workspace-scoped and does not require an active Vault. The Host streams the selected file
to temporary Job-derived storage without transferring whole package bytes through application
messages. The Export passphrase and recovered Root Key remain memory-only. Authentication failure
is retryable against the same staged file without disclosing which authenticated field differed.

After complete validation, Import SHALL reject any existing or partial destination scope for the
originating Vault ID with `VAULT_ALREADY_EXISTS`. It SHALL preserve the exact Vault ID, active
Generation, head, Events, Object records, and encrypted Artifact wrapper bytes. It SHALL create a
fresh Device ID, non-exportable device key, device slot, verifier, encrypted name cache, and
rebuildable Projections. Source device credentials and operational records SHALL NOT be imported.

Prepared wrappers become authoritative only with one atomic transaction that creates all compact
Vault records and marks the Import Job Succeeded. The imported Vault is manually locked. An empty
Workspace selects it without retaining the recovered Root Key; a populated Workspace leaves its
active Vault unchanged. Import never appends an Event, creates a Generation, merges, replaces,
repairs, or synchronizes an existing Vault.

A Local recovery fork created during stale-Replica resolution is not Import or Restore. The Runtime
re-authors the stale Vault's current logical state under fresh Vault, Generation, Event, Object,
Bundle, Artifact, Collection, key, and device identities. It does not consume a Vault Package and
does not claim to preserve operation or Undo history. The separately offered Complete Export is an
exact preservation option before that re-authoring step and remains importable later as the same
original stale Vault identity when no local collision exists.

# 9. Import Job and Recovery

One non-terminal Workspace Import Job owns an exclusive management lease. It fences Vault Create,
Select, Rename, Lock, Unlock, Capture, Library and Collection mutations, Vacuum, Export, and another
Import while allowing read-only access. Its stages are Acquire, Authenticate, Validate, Prepare,
Rebuild, and Commit. Cancellation before activation is terminal and removes staging plus prepared
wrappers; activation reports its actual atomic outcome once requests have been scheduled.

Runtime restart marks every non-terminal Import Job `IMPORT_INTERRUPTED`. Cleanup removes only its
Job-derived source and exact authenticated destination wrappers after proving no Vault directory
entry committed. Successful Jobs retain their authoritative wrappers.

# 10. Invariants

- No plaintext authoritative content appears in a Vault Package.
- Package bytes plus passphrase authenticate the exact captured Vault Generation.
- A Complete package is standalone; a Selective package truthfully preserves its omissions.
- The source Vault and all authoritative identifiers remain unchanged.
- Device keys and local slots never leave local storage.
- Export remains distinct from Backup and synchronization.
- Import remains distinct from Restore and synchronization.
- Import validates before destination writes and preserves every authoritative identity and byte.
- Imported local credentials and Projections are newly created and device-local.

# 11. Import Failure Contract

The Runtime SHALL expose these stable Import failure identifiers without including package
filenames, Vault names, decrypted metadata, passphrases, keys, or authentication detail:

- `IMPORT_AUTHENTICATION_FAILED` means that the passphrase/key-envelope authentication boundary
  could not be established. It is retryable while the staged source remains owned by the same Job.
- `IMPORT_PACKAGE_INVALID` means that package structure, authenticated reachability, replay,
  cryptographic content, or Complete coverage could not be proven. It is terminal.
- `SELECTIVE_IMPORT_UNSUPPORTED` means that a fully authenticated valid Selective package cannot be
  represented by the current local availability model. It is terminal and SHALL NOT be reported
  as corruption.
- `VAULT_ALREADY_EXISTS` means that the authenticated originating Vault ID already has any local
  directory or authority scope. It is terminal and SHALL NOT replace, merge, update, or reidentify
  that Vault.
- `IMPORT_INTERRUPTED` means that Runtime execution ownership ended before atomic activation. It is
  terminal; restart reconciliation SHALL clean only uncommitted Job-owned staging and wrappers.
- `STORAGE_QUOTA_EXCEEDED` means that source staging or prepared-wrapper storage cannot reserve the
  required capacity. It is terminal and SHALL leave no destination authority.

The shared `UNSUPPORTED_FORMAT_VERSION`, `VAULT_BUSY`, and `STORAGE_TRANSACTION_FAILED`
identifiers retain their owning Runtime meanings. Import SHALL map internal validator failures to
the identifiers above at its Service boundary. Unsupported or malformed content SHALL fail closed;
the Runtime SHALL NOT negotiate, migrate, or fall back to another package reader.
