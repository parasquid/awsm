# Search Service Specification

**Document:** `specifications/runtime/search.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Search Service provides local querying of archived content.

Search executes entirely within trusted clients.

No plaintext Search Projection Materializations are transmitted to synchronization servers.

---

# 2. Design Goals

The Search Service MUST provide:

- offline search
- incremental materialization updates
- deterministic results
- encrypted persistence
- extensibility

---

# 3. Architecture

```
Bundles

↓

Events

↓

Projection Builder

↓

Search Projection Materializations

↓

Search Service
```

The Search Service executes queries.

Projection Builders maintain Search Projection Materializations.

---

# 4. Responsibilities

The Search Service SHALL:

- parse queries
- execute searches
- rank results
- return matching Bundle identifiers

The Search Service SHALL NOT directly modify Projections or Materializations.

---

# 5. Searchable Sources

Search MAY include:

- Bundle metadata
- extracted text
- OCR output
- AI summaries
- user annotations
- tags
- URLs
- titles

Future searchable artifacts MAY be introduced.

---

# 6. Projection Materializations

The Runtime MAY maintain independent Search Projection Materializations.

Examples:

- Title Materialization
- URL Materialization
- Host Materialization
- Tag Materialization
- Text Materialization
- OCR Materialization
- AI Materialization
- Date Materialization

Materializations SHALL be independently rebuildable.

---

# 7. Projection Updates

Search Projection Materializations are updated through Runtime Events.

Example events:

- BundleRegistered
- OCRCompleted
- AISummaryGenerated
- TagsUpdated

Updates SHOULD be incremental.

---

# 8. Query Language

The Search Service SHALL support:

- keyword search
- phrase search
- tag search
- date filtering
- host filtering

Future query operators MAY be introduced.

---

# 9. Ranking

Ranking MAY consider:

- exact title matches
- keyword frequency
- phrase proximity
- tag matches
- recency

Ranking algorithms are implementation-defined.

---

# 10. Rebuild

Search Projection Materializations SHALL be rebuildable from authoritative Objects and Events.

Search Projection Materializations are derived data.

Search Projection Materializations SHALL NOT become authoritative.

---

# 11. Encryption

Persisted Search Projection Materializations SHALL be encrypted.

Materialization persistence SHALL use the Projection Domain keys.

---

# 12. Failure Recovery

Corrupted Search Projection Materializations MAY be discarded.

The Runtime SHALL rebuild Search Projection Materializations from authoritative data.

---

# 13. Diagnostics

The Search Service SHOULD expose:

- materialized bundle count
- last materialization update time
- pending updates
- rebuild progress

---

# 14. Future Extensions

Future search capabilities MAY include:

- semantic search
- image similarity
- embedding Materializations
- handwriting recognition
- multilingual normalization

---

# 15. Invariants

Bundles remain authoritative.

Search results come from Projections or Materializations.

Search Projection Materializations are rebuildable.

Queries never modify stored data.

Search executes locally.

---

# References

runtime.md

`docs/architecture/10-projection-engine.md`

`docs/specifications/bundle/bundle.md`

`docs/specifications/crypto/key-derivation.md`
