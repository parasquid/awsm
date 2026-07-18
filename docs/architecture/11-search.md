# Search Architecture

**Document:** `architecture/11-search.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- architecture/09-event-model.md
- architecture/10-projection-engine.md

---

# Purpose

This document defines the local search architecture used by Archive Platform.

Search is entirely client-side.

The Coordination Server never indexes or searches user content.

All searchable structures are derived from authoritative Objects and the Event Log.

---

# Design Goals

The search system must provide:

- offline operation
- instant response
- incremental indexing
- zero-knowledge
- extensibility
- deterministic rebuilding
- provider independence

---

# Philosophy

Bundles preserve information.

Search Projection Materializations discover information.

Materializations are disposable.

Bundles are authoritative.

---

# Search Pipeline

```
Bundle

↓

Extract Searchable Content

↓

Search Projection

↓

Search Providers

↓

Search Coordinator
```

Search never reads Bundles during query execution.

---

# Searchable Sources

Searchable information may include:

- page title
- URL
- extracted text
- notes
- tags
- AI summaries
- OCR text
- detected entities
- folder names
- archive names

Each source contributes independently.

---

# Search Coordinator

The Search Coordinator receives all search requests.

Responsibilities:

- dispatch requests
- merge provider results
- rank results
- remove duplicates
- apply filters

The Coordinator owns no index.

---

# Search Request

Every query is represented by a SearchRequest.

Example:

```text
Query

Filters

Sort

Limit

Ranking Profile

Search Scope
```

This abstraction allows future expansion without changing provider interfaces.

---

# Search Response

Search returns:

- archive references
- bundle references
- relevance score
- match explanation
- highlighted fields

Providers never return decrypted Bundle contents directly.

---

# Search Providers

Search capabilities are implemented by providers.

Examples:

Keyword Provider

Tag Provider

Date Provider

Folder Provider

Semantic Provider

Plugin Provider

Providers execute independently.

---

# Keyword Provider

Responsibilities:

- full-text search
- tokenization
- stemming
- phrase matching
- prefix matching

Implementation is replaceable.

---

# Tag Provider

Responsibilities:

- tag lookup
- hierarchical tags (future)
- tag suggestions

---

# Date Provider

Responsibilities:

- capture date
- archive date
- import date
- modification history

---

# Folder Provider

Responsibilities:

- folder hierarchy
- folder filtering

---

# Semantic Provider

Responsibilities:

- embedding lookup
- nearest-neighbor search
- semantic ranking

The Semantic Provider is optional.

If unavailable, search remains fully functional.

---

# Plugin Providers

Plugins may register additional providers.

Examples:

Code Search

Citation Search

People Search

Image Search

Plugin providers participate through the Coordinator.

---

# Search Projection

The Search Projection maintains provider Materializations.

It receives Events from the Projection Engine.

```
Event

↓

Search Projection

↓

Provider Materializations
```

Providers never consume Events directly.

---

# Projection Materialization Updates

When new Bundles arrive:

```
Bundle

↓

Extract Search Data

↓

Update Search Projection

↓

Update Provider Materializations
```

Materialization updates occur asynchronously.

---

# Ranking

Ranking combines provider scores.

Possible signals:

- textual relevance
- semantic similarity
- recency
- archive popularity
- exact matches
- tag matches

Ranking algorithms are replaceable.

---

# Highlighting

Highlights are generated from indexed text where possible.

Bundle reconstruction should occur only when necessary.

---

# Rebuilding

Search Projection Materializations may be discarded.

```
Delete Search Projection

↓

Replay Events

↓

Rebuild Materializations
```

No server interaction is required.

---

# Capture Source Artifacts

The initial Capture pipeline creates `TEXT_EXTRACTED` and `CONTENT_STRUCTURED` as immutable source
Artifacts from one ordered live-DOM semantic block stream. Projection Builders consume those
Artifacts to rebuild Search Projection Materializations without decrypting MHTML or screenshots.
The source Artifacts remain authoritative; the Search Materialization remains local, disposable,
and unsynchronized.

An optional extraction failure reduces Search coverage and is visible as a typed Capture warning.
It never invalidates mandatory `PRIMARY` preservation.

---

# Offline Operation

All Search Projection Materializations reside locally.

Search continues to function without network connectivity.

---

# Performance Goals

Target characteristics:

- sub-100 ms keyword queries
- incremental indexing
- background rebuilding
- streaming result generation
- bounded memory usage

---

# Privacy

Search Projection Materializations remain encrypted at rest if supported by the platform.

Materializations are never synchronized.

The backend never receives:

- queries
- Search Projection Materializations
- rankings
- search history

---

# Extensibility

Future providers may include:

- image similarity
- handwriting
- audio transcripts
- OCR confidence
- browser history correlation
- knowledge graph traversal

These require no protocol changes.

---

# Design Decisions

## Why Provider-Based?

Providers isolate search capabilities and simplify experimentation.

---

## Why a Coordinator?

The Coordinator centralizes ranking while allowing providers to evolve independently.

---

## Why Local Search?

Local search preserves privacy, supports offline operation, and aligns with the zero-knowledge architecture.

---

## Why Disposable Materializations?

Materializations are derived data and can always be regenerated from authoritative Objects and Events.

---

# Open Questions

Should ranking profiles be user-configurable?

Should semantic search be enabled automatically when embeddings exist?

Should plugin providers participate in global ranking or expose separate result groups?

How should duplicate results from multiple providers be merged?

---

# References

- `docs/architecture/12-processing-pipeline.md`
- `docs/architecture/13-capture-pipeline.md`
