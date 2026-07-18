# Import and Export Specification

**Document:** `specifications/portability/import-export.md`

**Version:** 1.0

**Status:** Draft

**Depends On:** `../core/serialization.md`, `../storage/object-store.md`, `../crypto/crypto.md`, `../vault/vault.md`, `../runtime/jobs.md`

---

# 1. Purpose

This specification defines the canonical portable Vault Package. Export is manual interchange; it is not Backup, synchronization, or persistent Vault recovery configuration.

The current product exports exactly one complete active Vault Generation. Partial Export, plaintext Export, merge Import, and user-facing Import are outside the current contract.

# 2. Required Properties

A Vault Package MUST:

- contain the active Generation's complete authoritative reachability;
- preserve all authoritative identifiers and encrypted bytes without mutation;
- exclude local device state and all rebuildable or operational state;
- be independently authenticatable using only the package and its export passphrase;
- support packages and entries beyond classic ZIP's 4 GiB boundary; and
- be producible without buffering the complete Vault in memory.

Export SHALL NOT change the source Vault. Failure or cancellation SHALL leave authoritative source bytes unchanged.

# 3. Canonical Container

The sole canonical format is:

```text
media type: application/vnd.awsm.vault+zip
filename extension: .awsm
export format version: 1
container: ZIP64
record encoding: canonical CBOR
entry compression: STORE (method 0)
```

Every entry and the central directory SHALL use ZIP64. Writers SHALL stream to temporary filesystem storage. They SHALL NOT construct the package as an in-memory Blob, base64 value, or classic ZIP archive.

Entries SHALL use forward-slash paths, lexical path order, a fixed DOS epoch modification time, and no comments, directory entries, platform permissions, extended timestamps, library encryption, or duplicate paths.

# 4. Exact Layout

Only these entries are permitted:

```text
key.cbor
manifest.cbor
generation.cbor
head.cbor
events/<event-id>.cbor
objects/<object-id>.cbor
```

`<event-id>` and `<object-id>` SHALL be canonical UUIDs equal to the identifier in the encoded record. No optional sections or empty directories exist.

# 5. Export Manifest

`manifest.cbor` SHALL encode this canonical record:

```text
ExportManifestV1 {
  exportFormatVersion: 1
  packageId: UUID
  createdAt: canonical UTC timestamp
  originatingVaultId: UUID
  vaultFormatVersion: 1
  bundleFormatVersion: 1
  eventFormatVersion: 1
  generationId: UUID
  generationNumber: non-negative integer
  objectCount: non-negative integer
  eventCount: non-negative integer
  supportedFeatures: ["full-vault", "vault-generation"]
  entries: ExportEntryDescriptorV1[]
  contentIntegrity: {
    algorithm: "hash:sha256:v1"
    checksum: bytes[32]
  }
}
```

Each `ExportEntryDescriptorV1` SHALL contain:

```text
path: canonical package path
recordType: "VaultGeneration" | "VaultHead" | "Event" | "Object"
recordId: UUID
byteLength: non-negative integer
checksumAlgorithm: "hash:sha256:v1"
checksum: bytes[32]
```

Descriptors exclude `manifest.cbor` and `key.cbor`, are sorted by path, and have unique paths and record identities. Counts SHALL equal their descriptor counts. `contentIntegrity.checksum` is SHA-256 over canonical CBOR of the ordered descriptor array.

The Manifest contains operational interchange metadata only. It SHALL NOT contain the Vault name, decrypted content, content-derived metadata, or local device information.

# 6. Export Key Envelope

`key.cbor` SHALL encode:

```text
ExportKeyEnvelopeV1 {
  exportKeyEnvelopeVersion: 1
  purpose: "VaultExport"
  packageId: UUID
  originatingVaultId: UUID
  algorithm: "wrap:xchacha20poly1305:passphrase:v1"
  kdf: "kdf:argon2id:v1"
  operations: 3
  memoryBytes: 67108864
  salt: bytes[16]
  nonce: bytes[24]
  manifestChecksumAlgorithm: "hash:sha256:v1"
  manifestChecksum: bytes[32]
  ciphertext: bytes[48]
}
```

Each Export SHALL use a fresh random salt and nonce. Argon2id SHALL derive a 32-byte key from a passphrase containing at least 12 Unicode code points and at most 1,024 UTF-8 bytes. XChaCha20-Poly1305 SHALL encrypt exactly the 32-byte Vault Root Key.

Associated data is canonical CBOR of this ordered array:

```text
[
  exportKeyEnvelopeVersion, purpose, packageId, originatingVaultId,
  algorithm, kdf, operations, memoryBytes, salt, nonce,
  manifestChecksumAlgorithm, manifestChecksum
]
```

`manifestChecksum` is SHA-256 of the exact `manifest.cbor` bytes. Raw Root Key and derived passphrase-key bytes SHALL be wiped after use. The envelope belongs only to the package and SHALL NOT be persisted as a local Vault key slot.

# 7. Authoritative Records

`generation.cbor`, `head.cbor`, Event entries, and Object entries encode the current canonical stored records without reinterpretation. Local Vault metadata, verifiers, device keys, device slots, and Workspace records SHALL NOT be exported.

Export SHALL include all Objects and Events in the union of the authenticated Generation's retained identifiers and the captured head's appended identifiers. This union SHALL exactly equal authoritative records stored for the scoped Vault. Deleted Captures remain authoritative until Vault Vacuum and therefore SHALL be included.

Before package creation, the Runtime SHALL authenticate the Generation, every Event, every Bundle, and every Artifact checksum; replay supported history; prove Event/Object references and reachability; and reject missing, extra, duplicate, unsupported, corrupt, or cross-Vault records.

The following SHALL NOT be exported:

- Projections and Materializations;
- caches and derived indexes;
- Commands and command outcomes;
- Jobs, leases, queues, temporary files, and diagnostics;
- local key slots, device keys, and device metadata; or
- synchronization cursors and operational registries.

# 8. Export Job and Snapshot Stability

Export SHALL execute through an Export Job holding an exclusive Vault-scoped lease. Lease acquisition SHALL atomically verify the expected active Vault and unlocked state, reject conflicting Jobs, capture the active head, and persist the Job before enumeration.

While the lease is active, Capture, Library mutation, Collection mutation, rename, active-Vault change, lock, Vault creation, and Vacuum SHALL fail with `VAULT_BUSY` in the same transaction that would mutate state.

The Runtime SHALL re-read and compare the active head before download. A mismatch invalidates the package. Job records SHALL NOT persist the passphrase, derived key, raw Root Key, Vault name, or temporary absolute path.

# 9. Completed-Package Validation

Before download, the Runtime SHALL validate the completed temporary package with the same read-only validator intended for Import. Validation SHALL:

1. validate ZIP64 structure, canonical paths/order, STORE method, and prohibited metadata;
2. strictly decode canonical `manifest.cbor` and `key.cbor`;
3. authenticate the Manifest checksum and unwrap the Root Key;
4. verify identity agreement across all records;
5. stream-check every inventoried byte length and SHA-256 checksum;
6. reject missing, extra, duplicate, or un-inventoried entries; and
7. authenticate Generation reachability, Event replay, Bundles, and Artifact checksums.

Readers SHALL apply fixed-record and existing per-Bundle allocation limits before allocation. STORE-only entries prevent decompression expansion.

Wrong passphrase, substituted envelope, and envelope-authentication failure SHALL return `EXPORT_AUTHENTICATION_FAILED` without revealing which field differed. Unsupported versions return `UNSUPPORTED_FORMAT_VERSION`. Other package failures return `EXPORT_PACKAGE_INVALID`.

# 10. Download, Cancellation, and Restart

The Host SHALL use a neutral filename derived from the package creation time and package ID, not the Vault name. Success occurs only after the user-selected download completes.

Cancellation SHALL propagate through hashing, writing, validation, and download; cancel any active browser download; delete the temporary file; and end in `Cancelled` without an error identifier.

Because the passphrase is never persisted, Created or Running Export Jobs found after Runtime restart SHALL become Failed with `EXPORT_INTERRUPTED` and SHALL NOT retry automatically.

# 11. Import Boundary

A future Import may use a validated package and passphrase to create the contained Vault with new local device metadata, a new non-exportable device key, device slot, and verifier. Import SHALL verify the complete package before any destination write.

No user-facing Import workflow is defined by this specification revision.

# 12. Invariants

- No plaintext authoritative content appears in a Vault Package.
- The source Vault remains unchanged.
- The package and passphrase are sufficient without the originating device or AWSM Service.
- The originating device key and device slot never leave local storage.
- Object, Event, Bundle, Vault, and Generation identifiers never change.
- Export does not become Backup, synchronization, or persistent local recovery configuration.
