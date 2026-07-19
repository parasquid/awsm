# Protocol Resources and Outcomes

**Document:** `specifications/protocol/messages.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- protocol.md
- http-api.openapi.yaml

---

# 1. Purpose

This document indexes the canonical protocol resources. It does not define a generic message
envelope. Exact HTTPS shapes belong to `http-api.openapi.yaml`; transport-independent behavior
belongs to `protocol.md`.

# 2. Control Resources

- Service policy reports effective retention, upload, paging, ticket, and notification limits.
- Vault attachment creates a provisional Vault and Generation-zero upload; completion publishes the
  first active Generation.
- Upload resources expose resumable part state and renew scoped tickets.
- Event closure commits publish exactly one Event and its declared dependencies.
- Active records provide full-replica enumeration and ticketed download.
- Changes provide snapshot-bounded incremental delivery by per-Vault Delivery Cursor.
- Generation candidates accept successor metadata, retained pages, sealing, activation, and discard.
- Recoveries expose one exact superseded Generation without changing the active head.
- Purges expose durable non-cancellable deletion progress.

# 3. Binary Transfer Resources

Upload-part and download URLs carry short-lived unguessable capabilities. Transfer requests still
require protocol and request IDs but do not carry Account credentials. The Service persists only a
SHA-256 digest of each capability. Binary bodies use `application/octet-stream`; JSON middleware
does not parse them.

# 4. Advisory Notification

`VaultChangesChannel` accepts one Account-owned Vault ID and publishes exactly `vaultId` and
`latestCursor`. The payload is a wake-up signal, never trusted state transfer.

# 5. Outcomes

Every non-success JSON response contains `outcome`, `retryable`, and `requestId`, plus only the
optional fields admitted by OpenAPI. Clients branch on the stable outcome identifier, not HTTP
diagnostic prose. Cross-Account requests use non-disclosing not-found or conflict outcomes.

# 6. Strictness

Unknown properties, malformed identifiers, unsafe integers, non-canonical timestamps, invalid
checksums, unsorted or duplicate dependency/reachability lists, and undocumented resource paths are
rejected. No unknown-field preservation or protocol negotiation exists in the pre-release contract.
