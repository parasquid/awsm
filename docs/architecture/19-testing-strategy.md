# Testing Strategy

**Document:** `architecture/19-testing-strategy.md`

**Status:** Draft

**Owner:** Engineering

**Depends On:**

- All architecture documents

---

# Purpose

This document defines the verification strategy for Archive Platform.

Testing is organized around architectural guarantees rather than implementation modules.

The objective is to continuously verify that the platform's core invariants remain true as the implementation evolves.

---

# Testing Philosophy

The platform relies on a small number of architectural guarantees.

Tests should verify these guarantees across every supported implementation.

Implementation details may change.

Architectural guarantees must not.

## Test-Driven Development

Implementation SHALL proceed through RED-GREEN-REFACTOR cycles:

1. add the smallest test for the next observable behavior;
2. run it and confirm that it fails for the expected missing behavior;
3. implement only enough production code to pass;
4. run the focused test;
5. refactor without changing behavior; and
6. run the affected suite.

Production behavior SHALL NOT precede its failing test. Every discovered defect SHALL receive a failing regression test before its fix.

Tests SHALL NOT be weakened, deleted, skipped, or rewritten merely to make a build green.

The first Chrome extension slice follows the task-level TDD gates in `docs/plans/02-chrome-extension-capture-vertical-slice.md`.

---

# Architectural Invariants

The following invariants are fundamental.

## Immutability

- Bundles are immutable.
- Events are immutable.
- Artifacts are immutable.

---

## Replay

- Replaying the same Event Log always produces identical Projections.
- Replay order is deterministic.
- Duplicate Events do not change state.

---

## Synchronization

- Synchronization is eventually consistent.
- Reordering of network delivery does not affect final state.
- Interrupted synchronization resumes safely.
- Duplicate uploads are harmless.

---

## Zero Knowledge

- Plaintext never leaves the trusted runtime.
- The Coordination Server never requires plaintext to operate.
- Search indexes never synchronize.

---

## Trust

- Only trusted devices may decrypt Vault data.
- Revoked devices cannot receive future wrapped keys.
- Authentication and trust remain separate concepts.

---

## Compatibility

- Older clients ignore unknown Event fields safely.
- Unknown Event types are preserved.
- Protocol negotiation is explicit.

---

# Test Pyramid

```
Property Tests

↓

Unit Tests

↓

Integration Tests

↓

System Tests

↓

Cross-Version Tests
```

Every layer contributes different confidence.

---

# Property-Based Testing

Property tests verify invariants rather than examples.

Examples:

- Replay is deterministic.
- Event ordering is stable.
- Serialization is reversible.
- Encryption round-trips correctly.
- Projection rebuilding is idempotent.

---

# Unit Tests

Every public component should have focused unit tests.

Examples:

- Event validation
- Bundle serialization
- Projection reducers
- Command validation
- Key derivation
- Search tokenization

---

# Integration Tests

Integration tests verify collaboration between components.

Examples:

- Capture → Bundle
- Bundle → Encryption
- Event → Projection
- Synchronization → Replay
- Processing → Artifact

---

# System Tests

System tests execute complete user workflows.

Examples:

Capture page

↓

Synchronize

↓

Restore on second device

Vault Vacuum tests MUST cover delete/restore replay, retained offline Bundle authentication, actual storage reclamation, transaction failure before activation, restart after activation where collection is asynchronous, unknown dependency failure, and stale-generation resurrection prevention.

Collection-management tests MUST begin with failing tests and cover exact fragmentless URL routing, query-sensitive automatic grouping, deterministic tie-breaking, merge redirects and cycles, Move/Extract assignment, compensating Undo, stale-state rejection, atomic Event/Projection commits, Projection rebuild, and Vacuum preservation. Packaged-browser tests MUST exercise accessible controls and native drag and drop, including Deleted-member behavior, known URLs, tail visit-original routing, and the ten-second single-operation Undo presentation.

↓

Verify identical state

---

# Cross-Version Tests

Every release should verify compatibility between versions.

Examples:

Old Client ↔ New Server

New Client ↔ Old Server

Mixed Event Versions

Mixed Bundle Versions

Mixed Protocol Versions

---

# Failure Injection

The runtime should be tested under failure conditions.

Examples:

- interrupted uploads
- interrupted downloads
- corrupted blocks
- duplicate events
- missing events
- clock skew
- network partitions
- storage exhaustion

Recovery should preserve architectural invariants.

---

# Cryptographic Testing

Verify:

- authenticated encryption
- key wrapping
- key rotation
- signature verification
- ciphertext integrity

Cryptographic test vectors should be retained across releases.

---

# Replay Verification

Given an Event Log:

```
Replay

↓

Projection A
```

Deleting all Projections and replaying again must produce an equivalent Projection.

---

# Projection Testing

Every Projection should support:

- empty replay
- incremental replay
- rebuild
- checkpoint restore (if implemented)

---

# Synchronization Testing

Multiple simulated devices should verify:

- concurrent updates
- duplicate uploads
- reconnect behavior
- conflict handling
- eventual convergence

---

# Performance Testing

Representative targets:

- replay throughput
- synchronization latency
- indexing throughput
- capture throughput
- memory usage
- startup time

Performance regressions should be tracked continuously.

---

# Security Testing

Security verification should include:

- authorization checks
- protocol validation
- malformed payloads
- capability enforcement
- extension sandboxing

---

# Browser Testing

The Capture Adapter should be tested across supported browsers.

Examples:

- Chrome
- Firefox

Tests should account for browser-specific API differences.

---

# Compatibility Matrix

The project should maintain a compatibility matrix covering:

- protocol versions
- bundle versions
- event versions
- extension API versions
- cryptographic versions

---

# Continuous Integration

Every change should execute:

- formatting
- static analysis
- unit tests
- property tests
- integration tests
- system tests

Long-running compatibility and performance suites may execute separately.

---

# Design Decisions

## Why Test Invariants?

Architectural guarantees define correctness more clearly than implementation details.

---

## Why Property-Based Testing?

Many synchronization and replay bugs are exposed more effectively by generated inputs than by fixed examples.

---

## Why Cross-Version Testing?

Independent client and server evolution requires explicit compatibility verification.

---

# Future Extensions

Future testing capabilities may include:

- deterministic network simulation
- fuzz testing
- protocol conformance suites
- third-party implementation certification

---

# References

- `docs/architecture/20-deployment-and-operations.md`
- `docs/specifications/bundle/bundle.md`
- `docs/specifications/event/event.md`
- `docs/specifications/protocol/protocol.md`
