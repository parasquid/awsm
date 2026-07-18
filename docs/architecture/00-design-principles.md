# Design Principles

**Document:** `architecture/00-design-principles.md`

**Status:** Normative

**Owner:** Architecture

---

# Purpose

This document defines the architectural principles that govern all design decisions within Archive Platform.

These principles take precedence over implementation convenience.

Whenever two designs are technically feasible, the design that best satisfies these principles should be preferred.

---

# 1. Preserve Before Interpret

The primary purpose of the platform is preservation.

Captured information should be stored as faithfully as possible before any interpretation, indexing, summarization, or transformation occurs.

Derived data must never replace original data.

---

# 2. Original Data Is Immutable

Original captured content is never modified.

Corrections, annotations, tags, summaries, and metadata are represented as new events rather than modifications of archived content.

Immutability simplifies synchronization, auditing, replay, and long-term preservation.

---

# 3. Client Owns Plaintext

Plaintext exists only within trusted client runtimes.

The server stores encrypted data and coordination metadata only.

This principle applies to all future features unless an explicit exception is documented.

---

# 4. The Server Coordinates, Never Understands

The coordination server manages:

- synchronization
- authentication
- authorization
- device trust
- storage coordination
- tenant management

The server does not interpret archive contents.

It should never require decrypted archive data to fulfill its responsibilities.

---

# 5. Events Represent History

State is derived from events.

Events record facts that occurred.

Current state is a projection derived from replaying those facts.

History is authoritative.

State is disposable.

---

# 6. Projections Are Disposable

Any projection must be reproducible solely from the Event Log.

Deleting a projection must never result in data loss.

Rebuilding projections should always be supported.

---

# 7. Protocols Over Transports

Application behavior is defined by protocols.

HTTP, WebSockets, gRPC, and future transports are implementation details.

The protocol remains stable even when transports evolve.

---

# 8. Specifications Over Implementations

Bundle formats, event schemas, cryptographic formats, and synchronization protocols are defined independently of any programming language or framework.

The Rails server and browser runtime are reference implementations.

---

# 9. Offline First

Every feature should function without continuous network connectivity whenever practical.

Synchronization is opportunistic.

The local vault remains authoritative for the user's own data.

---

# 10. Synchronization Is Eventual

The platform favors eventual consistency over strong consistency.

Temporary divergence between devices is expected.

Given successful synchronization, all trusted devices should converge to the same logical state.

---

# 11. Encryption Before Synchronization

Data is encrypted before leaving the trusted client.

Synchronization never requires plaintext.

Object storage never receives unencrypted archive content.

---

# 12. Least Privilege

Every component receives only the permissions necessary to perform its responsibilities.

This applies to:

- extensions
- devices
- services
- future shared vault participants

---

# 13. Capability-Based Extensibility

Extensions interact with the platform through explicitly granted capabilities.

They request commands.

They do not mutate authoritative state directly.

---

# 14. Determinism Wherever Practical

Given identical inputs, identical software versions, and identical configuration, the platform should produce equivalent outputs.

Non-deterministic behavior must be explicitly justified and documented.

---

# 15. Version Everything

Every externally persisted structure should include an explicit version.

Examples include:

- bundles
- events
- protocol messages
- cryptographic formats
- extension APIs

Versioning enables long-term compatibility.

---

# 16. Backwards Compatibility Is a Feature

Existing archives should remain readable after software upgrades whenever practical.

Migration should be additive rather than destructive.

Breaking compatibility requires explicit architectural justification.

---

# 17. Open Standards Where Practical

Prefer documented, widely implemented standards over proprietary formats.

Examples include:

- MHTML
- CBOR
- JSON
- MIME
- HTTPS

Platform-specific formats should be isolated behind adapters.

---

# 18. Fail Safely

Unexpected failures should preserve user data.

If correctness cannot be guaranteed, the platform should refuse the operation rather than risk silent corruption.

---

# 19. Test Architectural Guarantees

Testing should focus on validating architectural invariants rather than implementation details.

Architectural guarantees define correctness.

---

# 20. Simplicity Over Cleverness

A simpler architecture with clear responsibilities is preferred over a more sophisticated design with hidden complexity.

Optimization should follow demonstrated need rather than speculation.

---

# Architectural Review Checklist

Every new feature should answer the following questions:

1. Does it preserve original captured data?
2. Does it introduce mutable authoritative state?
3. Does plaintext leave the trusted client?
4. Can it operate offline?
5. Is it represented as events where appropriate?
6. Can derived state be rebuilt?
7. Does it violate the zero-knowledge model?
8. Does it introduce unnecessary coupling?
9. Is it versioned?
10. Can it evolve without breaking existing archives?

If any answer is "yes" to a potential violation, the design should undergo an explicit architectural review.

---

# Non-Goals

The platform is not designed to:

- optimize for server-side processing of user content
- require permanent online connectivity
- depend on proprietary storage providers
- require a single programming language implementation
- sacrifice long-term preservation for short-term convenience

---

# References

This document applies to all architecture and specification documents in the repository.
