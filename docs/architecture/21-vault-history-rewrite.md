# Vault History Rewrite

**Document:** `docs/architecture/21-vault-history-rewrite.md`

**Version:** 1.0

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- `docs/architecture/00-design-principles.md`
- `docs/architecture/07-content-storage.md`
- `docs/architecture/08-synchronization.md`
- `docs/specifications/vault/vacuum.md`

## Intent

Logical deletion alone cannot reclaim immutable Bundle storage. AWSM therefore uses Git-like reachability: a Vault History Rewrite builds a new verified generation that excludes deleted Captures, switches the authoritative root, and makes the predecessor's unreferenced Objects eligible for garbage collection.

```text
Active generation
      │ build without Deleted
      ▼
Verified successor ── atomic head switch ──▶ authoritative
      │
      └── predecessor-only Objects ──▶ garbage collection
```

Immutability applies to Objects, not to which immutable Object graph is authoritative. Replacement history receives a new generation identity; no Bundle, Event, Manifest, or identifier is edited in place.

Between generation creation and Vacuum, new immutable Objects and Events form an append tail recorded atomically in the local active head. The immutable manifest is the generation base; base plus tail is its complete reachability root. Vacuum verifies that union against storage, then folds retained tail entries into the successor immutable manifest with an empty tail. This permits ordinary append-only capture without rewriting a manifest in place.

## Product model

The Library exposes Active Collections first and a collapsed Deleted accordion beneath them. Delete is reversible until Vacuum. Vacuum is manual, lives inside Deleted, processes all currently Deleted Captures, and is suggested only under meaningful storage pressure. Individual and Collection deletion share one Bundle-ID-based domain operation: the Command resolves the current effective Collection to explicit Bundle IDs.

A Collection is a stable Event-backed logical identity, not an authoritative Object or mutable container. `CollectionsMerged`, `CapturesMoved`, and `CollectionMergeReverted` preserve user-directed topology. Vacuum retains or rewrites the minimum management history needed to reproduce each retained Capture's effective Collection, including filtering mixed move Events under new Event IDs. It aborts on unknown topology dependencies before activation.

## Rewrite policy

Unchanged Objects are reused. Objects exclusively owned by Deleted Captures are omitted. Mixed-reference structures require type-specific rewrite handlers and new identifiers. Unknown types stop the Job. The predecessor ID is audit metadata rather than a reachability edge.

The browser implementation may combine activation and physical deletion in one IndexedDB transaction. Larger Drivers may activate first and perform resumable asynchronous collection, but must preserve the same visible atomic boundary.

The browser Driver persists a plaintext-opaque Job lease containing only random Job and generation identifiers, stage, and timestamp. Acquiring it fences new authoritative writes before analysis. Because activation, Materialization publication, collection, head replacement, and lease removal share one IndexedDB transaction, a terminated worker exposes either the predecessor plus an abandoned pre-activation lease or the complete successor. Startup removes only such abandoned pre-activation leases; it never rolls back an activated successor.

## Trade-offs

Vacuum maximizes local storage reclamation without re-encrypting retained content. It cannot guarantee removal from disconnected copies and therefore is deliberately weaker than Secure Scrub. Generation metadata adds a small opaque synchronization signal so stale replicas cannot resurrect predecessor history.

## References

- `docs/specifications/vault/vacuum.md`
- `docs/architecture/07-content-storage.md`
- `docs/architecture/08-synchronization.md`
- `docs/architecture/10-projection-engine.md`
