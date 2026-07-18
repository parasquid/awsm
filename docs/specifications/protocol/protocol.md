# Archive Synchronization Protocol

**Document:** `specifications/protocol/protocol.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This specification defines the Archive Synchronization Protocol.

The protocol enables trusted clients to synchronize immutable Bundles, Events, wrapped cryptographic keys, and coordination metadata with a Coordination Server.

The protocol is transport-independent.

---

# 2. Goals

The protocol MUST provide:

- eventual consistency
- resumable synchronization
- deterministic behavior
- offline operation
- transport independence
- one canonical deterministic message format

---

# 3. Non-Goals

The protocol does not define:

- authentication mechanisms
- UI behavior
- search
- archive rendering
- AI processing

---

# 4. Architecture

```
Client

↓

Archive Protocol

↓

Transport

↓

Coordination Server
```

Transport examples include:

- HTTP
- WebSocket
- future transports

---

# 5. Synchronization Model

Clients are authoritative for plaintext.

Servers coordinate encrypted objects.

Servers never interpret Bundle contents.

Synchronization is append-only.

---

# 6. Protocol Objects

The protocol exchanges only protocol objects.

Examples:

- Bundle
- Event
- Wrapped Key
- Device Record
- Synchronization Cursor
- Block

No transport-specific objects are defined.

---

# 7. Message Model

Every interaction is represented as a protocol message.

Messages are independent of transport.

Each message contains:

- Message Type
- Protocol Version
- Request Identifier
- Payload

Optional fields:

- Correlation Identifier
- Compression Information

---

# 8. Core Messages

Examples include:

ClientHello

ServerHello

Authenticate

SubmitEvents

FetchEvents

SubmitBundles

FetchBundles

SubmitBlocks

FetchBlocks

FetchWrappedKeys

SubmitWrappedKeys

FetchDevices

SubmitDevice

Heartbeat

Error

---

# 9. Synchronization

Synchronization proceeds conceptually as:

```
Client

↓

Determine Differences

↓

Exchange Events

↓

Exchange Bundles

↓

Exchange Blocks

↓

Update Cursor

↓

Complete
```

The exact optimization strategy is implementation-defined.

---

# 10. Idempotency

Protocol messages SHOULD be safe to retry.

Duplicate submissions MUST NOT corrupt Vault state.

---

# 11. Ordering

Events MUST preserve ordering.

Bundles are immutable and MAY be transferred independently.

Blocks MAY transfer in parallel.

---

# 12. Protocol Selection

The client and Service use the one protocol defined by this specification.

No negotiation or alternate protocol path exists before the first release and an explicit compatibility decision.

---

# 13. Compression

Messages MAY be compressed.

Compression negotiation occurs during session establishment.

Compression MUST NOT alter protocol semantics.

---

# 14. Encryption

Protocol encryption is distinct from transport encryption.

Archive objects remain encrypted before transmission.

Transport security provides additional protection but is not relied upon for confidentiality of archive contents.

---

# 15. Error Handling

Errors SHALL be represented as protocol messages.

Errors MUST NOT terminate synchronization unless recovery is impossible.

---

# 16. Extensions

New protocol messages MAY be introduced.

Unknown messages MUST be ignored unless explicitly marked mandatory.

---

# 17. Invariants

Protocol semantics are transport-independent.

Bundles remain immutable.

Events remain append-only.

Servers never require plaintext.

Synchronization is resumable.

Vault Generation activation is fenced by opaque compare-and-swap metadata.

---

# 18. Future Capabilities

Future approved work MAY introduce:

- streaming synchronization
- peer-to-peer synchronization
- LAN discovery
- incremental object transfer

This section does not authorize alternate protocol formats or negotiation paths.

---

# References

messages.md

errors.md

event/event.md

bundle/bundle.md
