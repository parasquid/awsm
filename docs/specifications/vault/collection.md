# Collection Specification

**Document:** `docs/specifications/vault/collection.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- `docs/specifications/event/event.md`
- `docs/specifications/event/commands.md`
- `docs/specifications/runtime/capture.md`
- `docs/specifications/vault/vacuum.md`

## 1. Purpose

A Collection is a stable logical identity that groups Captures the user considers versions of one page. Collection membership and identity redirects are derived by replaying immutable Vault Events; a Collection is not a mutable container or authoritative Object.

## 2. Assignment and automatic routing

Every accepted `BundleRegistered` Event MUST name one assigned Collection ID. A new Capture routes to the newest Active Collection containing an exact fragmentless URL match. Query parameters remain significant. When several Collections qualify, the newest tail wins and ascending Collection ID breaks a tie. If none qualifies, capture creates a new Collection ID.

Redirect resolution is status-independent. A Collection ID redirected by an active merge resolves transitively to the destination. Cycles and stale roots MUST be rejected with `LIBRARY_STATE_CHANGED`.

## 3. Management Commands

The local Commands are `MergeCollections`, `MoveCaptures`, `ExtractCaptures`, and `UndoLibraryOperation`.

- Merge redirects one or more source Collection identities into an explicit destination; the destination selected by the user always wins.
- Move assigns explicit Bundle IDs to an existing destination Collection.
- Extract creates one new Collection ID and assigns every selected Bundle ID to it.
- Undo validates that the referenced operation's effect is still current, then records a compensating Event. It never edits or removes history.

Commands MUST validate complete input before writing. One accepted operation MUST commit its Event, affected Projection rows, Collection-state Materialization, and active-generation tail update atomically. A stale operation changes nothing.

## 4. Events

`CollectionsMerged` records canonical source Collection IDs and an explicit destination Collection ID. It creates redirect facts and does not rewrite Capture assignments.

`CapturesMoved` records, for each Bundle ID, both its exact assigned Collection ID before the operation and its assigned Collection ID afterward. Extract uses this Event and differs only at the Command boundary.

`CollectionMergeReverted` names one active `CollectionsMerged` Event whose redirect is deactivated. An inverse move swaps each original move's source and destination and names the Event it reverts.

Identifier lists MUST use canonical ascending order. Events and immutable Bundle Objects MUST remain present after management and Undo.

## 5. Projection and replay

Replay first applies `BundleRegistered`, lifecycle Events, and `CapturesMoved` to recover assigned membership and Active/Deleted status. It then resolves accepted `CollectionsMerged` redirects excluding merge Events named by `CollectionMergeReverted`.

The Library Projection exposes effective Collection membership, ordered Captures, the newest Capture as the tail, and the deduplicated known-URL list. Collection visit-original uses the tail Capture's URL; each Capture retains its own original URL.

Projection rows and Collection-state Materializations are encrypted, disposable, and rebuildable solely from authoritative Events and Objects.

## 6. Undo and conflicts

Undo Move or Extract is accepted only while every affected Capture retains the destination assignment written by the original Event. Undo Merge is accepted only while its merge edge is active and unreverted. Any later conflicting operation MUST fail the entire Undo with `LIBRARY_STATE_CHANGED`.

The user interface's ten-second Undo window is presentation policy, not an Event expiry rule.

## 7. Deletion and Vacuum

Deletion and restoration resolve the selected Collection to explicit Bundle IDs when their Commands are accepted. Merge resolution includes Active and Deleted members, so restoring a merged Capture returns it to the effective merged Collection.

Vault Vacuum MUST preserve or rewrite management Events needed to reproduce every retained Capture's effective Collection. A mixed `CapturesMoved` Event may be rewritten under a new Event ID with reclaimed moves removed. Unknown management Events or dependencies fail closed.

## 8. Invariants

- Captures and prior Events are never mutated.
- Query differences do not merge automatically.
- User-directed Merge, Move, and Extract work offline.
- Projection rebuild is deterministic and idempotent.
- No operation partially commits.
