# Protocol Messages Specification

**Document:** `specifications/protocol/messages.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- protocol.md
- event/event-format.md

---

# 1. Purpose

This document defines every message exchanged by the Archive Synchronization Protocol.

All protocol messages share a common envelope.

The envelope is transport-independent.

---

# 2. Message Envelope

Every message SHALL contain:

Header

Body

Integrity

---

# 3. Header

The Header SHALL contain:

- Message Type
- Protocol Version
- Message Identifier
- Session Identifier
- Timestamp

Optional:

- Correlation Identifier
- Compression Indicator

---

# 4. Body

The Body depends upon Message Type.

Unknown Body fields MUST be preserved.

---

# 5. Integrity

The Integrity section SHALL contain:

- checksum
- signature (optional)
- cryptographic version

---

# 6. ClientHello

Purpose:

Begin protocol negotiation.

Body:

- supported protocol versions
- supported compression methods
- supported extensions
- client implementation identifier

Expected response:

ServerHello

---

# 7. ServerHello

Purpose:

Negotiate protocol.

Body:

- selected protocol version
- selected compression
- server capabilities

---

# 8. Authenticate

Purpose:

Authenticate client.

Body:

- authentication token
- device identifier

Expected response:

AuthenticationResult

---

# 9. AuthenticationResult

Body:

- success
- session identifier
- expiration

---

# 10. UploadObjects

Purpose:

Upload protocol objects.

Body:

List of Objects.

Objects MAY include:

- Events
- Bundles
- Blocks
- Wrapped Keys
- Device Records

The server SHALL validate every object independently.

---

# 11. DownloadObjects

Purpose:

Request objects missing locally.

Body:

- object type
- object identifiers
- synchronization cursor

---

# 12. UploadResult

Contains:

- accepted objects
- rejected objects
- retryable failures

---

# 13. DownloadResult

Contains:

Requested Objects.

Objects MAY be streamed.

---

# 14. Heartbeat

Purpose:

Verify session health.

Contains no application data.

---

# 15. SynchronizationStatus

Contains:

- local cursor
- server cursor
- pending object count

---

# 16. Error

Contains:

- error code
- message
- retry hint

Optional:

- offending object identifier

---

# 17. Message Ordering

Messages MAY arrive out of order.

Individual object ordering rules remain unchanged.

---

# 18. Retry

Retry SHALL be safe.

Duplicate UploadObjects MUST NOT duplicate state.

---

# 19. Compression

Compression applies to the Body only.

Header remains uncompressed.

---

# 20. Unknown Messages

Unknown Message Types SHALL be ignored unless marked mandatory by protocol negotiation.

---

# 21. Invariants

Every message has the same envelope.

Bodies are type-specific.

Messages remain transport-independent.

Retry is safe.

---

# 22. Vault Generation Fields

Synchronization handshake, cursor, upload, and activation messages carry an opaque generation number and generation root identifier. The Coordination Server compares these fields but MUST NOT inspect the encrypted Vault Generation manifest.

Generation activation names the expected predecessor root and uses compare-and-swap. Upload against a non-active root returns `VAULT_GENERATION_SUPERSEDED`. The local append-tail identifier list is not a wire field; ordinary synchronization cursors account for Objects appended within the active generation.

---

# References

errors.md

protocol.md
