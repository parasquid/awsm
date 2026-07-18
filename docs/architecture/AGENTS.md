# ARCHITECTURE DOCUMENTATION

## OVERVIEW

This directory explains system intent, trust boundaries, component responsibilities, and trade-offs; only `00-design-principles.md` and `glossary.md` are marked Normative.

## STRUCTURE

| Area | Documents | Purpose |
|------|-----------|---------|
| Foundations | `00`-`04`, `glossary.md` | Principles, system/domain model, zero knowledge, security |
| Client data model | `05`-`10` | Runtime, Bundles, storage, synchronization, Events, Projections |
| Features | `11`-`14` | Search, processing, capture, device trust |
| Service boundaries | `15`-`18` | Coordination server, protocol, extensions, cryptography |
| Assurance | `19`-`20` | Testing and deployment/operations |
| Reconciliation | `consistency-review.md` | Recorded fixes, dependency graph, unresolved questions |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Make an architectural decision | `00-design-principles.md` | Apply its decision checklist first |
| Name a concept | `glossary.md` | Canonical spelling and meaning |
| Place a component | `01-system-overview.md`, `02-domain-model.md` | Domain model yields to glossary/specs on conflict |
| Check privacy boundaries | `03-zero-knowledge.md`, `04-security-model.md`, `18-cryptography.md` | Client owns plaintext; server coordinates opaque data |
| Change client behavior | `05-client-runtime.md` | Host integrates; Runtime owns business logic |
| Change authoritative/derived state | `07-content-storage.md`, `09-event-model.md`, `10-projection-engine.md` | Reconcile with Object Store and Vault specs |
| Change network behavior | `08-synchronization.md`, `15-coordination-server.md`, `16-archive-protocol.md` | Protocol semantics remain transport-independent |
| Check known inconsistencies | `consistency-review.md` | Verify record against current normative sources |

## CONVENTIONS

- Keep numbered documents layered: foundations before runtime/storage, then features/services, then testing and operations.
- State responsibilities and invariants independently of frameworks; name concrete technologies only as reference implementations or adapters.
- Use `Depends On` metadata when a document relies on another, but inspect paths manually because existing forms are inconsistent.
- Describe authoritative persistence as immutable Objects; qualify Bundle/Event/Manifest authority as domain semantics or logical history where needed.
- Long-running capture, synchronization, AI, projection rebuild, import/export, backup/restore, and garbage collection execute through Runtime Jobs.
- Search queries operate over Search Projection Materializations; Projection Builders own updates from authoritative Objects and Events.

## ANTI-PATTERNS

- Do not let draft architecture override the normative glossary or an owning formal specification.
- Do not treat `consistency-review.md` as authority merely because it records a prior reconciliation.
- Do not introduce platform or vendor names as core concepts.
- Do not collapse Host, Runtime, Service, Driver, Projection, and Materialization boundaries.
- Do not describe mutable state, caches, registries, or server replicas as the source of Vault truth.

## OPEN CONSISTENCY WORK

The Chrome extension plan resolves `BundleRegistered`, the first Capture Profile, Chrome-only browser scope, deterministic ZIP plus canonical CBOR, IndexedDB storage, derived context keys, and interrupted-capture behavior. Remaining open work covers minimum Restore flow, Backup retention, acceptable synchronization metadata leakage, and follow-up checks in `10-projection-engine.md` and `12-processing-pipeline.md`.
