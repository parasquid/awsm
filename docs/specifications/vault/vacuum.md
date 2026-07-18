# Vault Vacuum Specification

**Document:** `docs/specifications/vault/vacuum.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- `docs/specifications/vault/vault.md`
- `docs/specifications/event/event.md`
- `docs/specifications/storage/object-store.md`
- `docs/specifications/runtime/jobs.md`
- `docs/specifications/runtime/storage.md`

## 1. Purpose

Vault Vacuum reclaims storage occupied by Captures in the Deleted state. It creates and verifies a successor Vault Generation, atomically makes that generation authoritative, and deletes Objects unreachable from it. Existing Objects are never modified.

Vault Vacuum is not Projection compaction, key rotation, cryptographic erasure, Backup retention, or Secure Scrub.

## 2. Capture lifecycle

`CapturesDeleted` moves explicit Bundle IDs from Active to Deleted. `CapturesRestored` moves explicit Bundle IDs from Deleted to Active. Deleted Captures MUST remain authenticatable, viewable, downloadable, and restorable until Vacuum activates a successor generation.

Collection deletion and restoration MUST resolve the current Collection to explicit Bundle IDs before the Command is accepted. Later or concurrent Captures of the same page are not affected. Collection identity and membership follow `docs/specifications/vault/collection.md`.

## 3. Vault Generation

A Vault Generation is an encrypted immutable authoritative reachability manifest for one stable Vault ID. It contains a version, Vault ID, generation ID, monotonic generation number, creation time, initiating Device ID, reason, retained authoritative Object identifiers, ordered retained Event identifiers, and integrity metadata.

Generation zero MUST be created and encrypted atomically with a new Vault; it MUST NOT be inferred. Its reason is `Initial`, its generation number is zero, and its reachability sets are empty. A Vacuum successor has reason `Vacuum` and increments the active generation number by exactly one.

A successor MAY record its predecessor generation ID as lineage metadata. That scalar identifier MUST NOT constitute a live Object reference or keep the predecessor graph reachable.

The active generation head is operational coordination state. In addition to the immutable manifest root, it records canonical sorted opaque Object and Event identifiers appended since that manifest was created. Every authoritative append updates this tail in the same transaction. Complete active reachability is the union of the immutable manifest and this append tail; Vacuum MUST verify that union exactly covers authoritative storage and folds all retained tail entries into the successor manifest. Synchronization exposes only the opaque generation root/number and its normal cursor, not the local tail list. Activation MUST compare-and-swap the head observed at Vacuum preflight.

The local browser slice serializes authoritative writes by acquiring a persisted opaque Vacuum lease before taking its snapshot. Capture, delete, restore, Merge, Move, Extract, and Undo commits MUST check that no lease exists in the same transaction as their authoritative writes. A lease abandoned before activation is safe to discard on restart because the browser slice activates and collects in one transaction; a committed activation deletes its lease in that transaction.

## 4. Vacuum algorithm

Vacuum SHALL:

1. require an unlocked Vault;
2. snapshot all Captures currently in Deleted;
3. authenticate every retained Bundle Descriptor, Artifact wrapper, and authoritative Event;
4. abort on an unsupported authoritative Object or Event type;
5. compute retained and unreachable dependency closure;
6. reuse unchanged immutable Objects and rewrite only affected immutable structures under new identifiers;
7. create and encrypt the successor generation manifest;
8. replay and verify retained logical state before activation;
9. atomically activate the successor and remove unreachable local Object/Event records, Projection
   rows, and obsolete operational outcomes before deleting their external Artifact wrapper files;
10. report deleted Capture count and actual reclaimed bytes without plaintext content in diagnostics.

`VaultCreated` and `VaultRenamed` are supported authoritative Events. Vacuum MUST authenticate and retain them byte-for-byte, include them in successor reachability, rebuild the Vault Name Projection, and prove that the final name and source Event remain unchanged before activation.

Every Vacuum lease, estimate, snapshot, reachability query, activation, and collection operation MUST be scoped to one Vault ID and MUST NOT inspect or modify another Vault in the same Workspace.

After successful Vacuum, every pre-Vacuum Active Capture MUST remain Active and authenticatable, Deleted MUST be empty, and no active reference may point to an omitted Object.

Reachability for a retained Bundle SHALL include its descriptor and every Artifact Object referenced
by that descriptor. Reclaimable bytes for an Artifact use the exact external wrapper length, with
safe counters beyond 4 GiB. Startup reconciliation SHALL remove orphan wrapper files but SHALL treat
a committed Artifact record with a missing or corrupt wrapper as corruption.

Vacuum MUST retain or rewrite `CollectionsMerged`, `CapturesMoved`, and `CollectionMergeReverted` whenever they affect a retained Capture's effective Collection. It MAY omit facts concerning only reclaimed Captures or identities with no retained members. A mixed `CapturesMoved` Event MUST be rewritten under a new Event ID with only retained moves. Verification MUST prove that each retained Capture remains in the same effective Collection.

## 5. Failure and cancellation

Failure before activation leaves the predecessor authoritative. Failure after activation leaves the successor authoritative and cleanup MUST be resumable. An implementation using one local storage transaction for activation and collection satisfies this boundary because transaction abort exposes the complete predecessor and commit exposes the complete successor.

Cancellation is allowed only before activation. Garbage collection MUST never use an unverified or inactive manifest.

## 6. Synchronization boundary

Synchronization peers SHALL exchange opaque active generation number and root ID. A superseded generation cannot submit authoritative history into the active generation and MUST receive `VAULT_GENERATION_SUPERSEDED`. A stale replica with unpublished work is quarantined for explicit recovery rather than merged or deleted automatically.

## 7. Backup and erasure boundary

Vacuum does not inspect or remove exports, old Backup Sets, or offline replicas. A superseded Backup Set MUST NOT merge into a newer active generation. Vacuum does not rotate the Vault Root Key and MUST NOT be described as Secure Scrub or guaranteed erasure.

## 8. Invariants

- Vault ID remains stable.
- Existing Objects are never modified.
- Only verified successor history becomes authoritative.
- Deleted Captures are recoverable before activation and unavailable afterward.
- Retained Captures survive Vacuum byte-for-byte.
- Unknown dependencies fail closed.
- Retained Captures preserve their effective Collection membership.

## References

- `docs/specifications/vault/vault.md`
- `docs/specifications/event/event.md`
- `docs/specifications/storage/object-store.md`
- `docs/specifications/runtime/jobs.md`
- `docs/specifications/runtime/storage.md`
- `docs/specifications/runtime/synchronization.md`
- `docs/specifications/vault/collection.md`
