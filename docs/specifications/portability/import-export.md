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

# 8. Import Boundary

A future Import may validate Complete or Selective packages and create the contained Vault with new
local device metadata. It SHALL validate the entire package before any destination write and retain
explicit unavailability only for authenticated permitted omissions. No user-facing Import workflow
is currently defined.

# 9. Invariants

- No plaintext authoritative content appears in a Vault Package.
- Package bytes plus passphrase authenticate the exact captured Vault Generation.
- A Complete package is standalone; a Selective package truthfully preserves its omissions.
- The source Vault and all authoritative identifiers remain unchanged.
- Device keys and local slots never leave local storage.
- Export remains distinct from Backup and synchronization.
