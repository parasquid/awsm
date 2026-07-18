# Command Specification

**Document:** `specifications/event/commands.md`

**Version:** 1.0

**Status:** Draft

**Depends On:**

- event.md
- event-format.md

---

# 1. Purpose

Commands represent requests to modify Vault state.

Commands are validated by the client runtime.

Successful Commands produce one or more Events.

Commands are never synchronized.

Commands are not part of the permanent history.

---

# 2. Design Goals

Commands MUST provide:

- explicit intent
- validation
- deterministic event generation
- atomic execution

---

# 3. Command Lifecycle

```
User

↓

Command

↓

Validation

↓

Transaction

↓

Events

↓

Projection Update
```

Commands exist only during execution.

---

# 4. Command Structure

Every Command SHALL contain:

- Command ID
- Command Type
- Command Version
- Issuing Device ID
- Creation Timestamp
- Payload

Optional fields MAY include:

- Correlation ID
- Extension ID
- User Interface Context

---

# 5. Validation

Every Command MUST be validated before execution.

Validation SHALL verify:

- required fields
- schema compliance
- capability authorization
- business rules
- referenced object existence (where applicable)

Validation failures MUST NOT produce Events.

---

# 6. Transactions

Command execution SHALL occur within a Transaction.

Transactions MUST either:

- produce all Events, or
- produce none.

Partial execution is prohibited.

---

# 7. Event Production

A Command MAY produce:

- zero Events (e.g. a no-op)
- one Event
- multiple Events

The Event sequence MUST be deterministic.

---

# 8. Determinism

Given:

- identical Vault state
- identical Command
- identical runtime version

the generated Events MUST be equivalent.

---

# 9. Idempotency

Commands are not required to be idempotent.

Events MUST remain idempotent.

Implementations MAY detect duplicate Commands to improve user experience, but replay correctness MUST depend on Events rather than Commands.

---

# 10. Authorization

Command execution SHALL verify that the issuing principal possesses all required capabilities.

Capability evaluation occurs before Event generation.

---

# 11. Extensions

Extensions SHALL submit Commands through the same public API used by first-party components.

Extensions MUST NOT append Events directly to the Event Log.

---

# 12. Standard Commands

Examples include:

- CapturePage
- RegisterBundle
- RemoveBundle
- AddTag
- RemoveTag
- CreateFolder
- RenameFolder
- MoveBundle
- AddNote
- EnrollDevice
- RevokeDevice
- RotateVaultKey

This list is informative rather than exhaustive.

`CapturePage` is the first Chrome Host Command. It requests capability preflight and live acquisition through the Capture Service. Successful execution persists the immutable Bundle Object before producing `BundleRegistered`. Capture failure produces no Vault Event.

`DeleteCaptures` and `RestoreCaptures` name a non-empty, duplicate-free canonical list of explicit Bundle IDs. They reject the entire request when any Bundle is absent from the expected Active or Deleted state. Accepted requests produce `CapturesDeleted` and `CapturesRestored` respectively.

`MergeCollections` redirects explicit source Collection identities into the user-selected destination and produces `CollectionsMerged`. `MoveCaptures` assigns explicit Bundle IDs to an existing Collection. `ExtractCaptures` assigns explicit Bundle IDs to one newly generated Collection. Both membership Commands produce `CapturesMoved`.

`UndoLibraryOperation` names the Event receipt returned by the latest reversible Collection operation. It produces an inverse `CapturesMoved` or `CollectionMergeReverted` only when the original effect is still current; otherwise it fails atomically with `LIBRARY_STATE_CHANGED`.

`VacuumVault` is a local destructive Runtime Job request. It never synchronizes as a Command and processes the Deleted snapshot established after acquiring the active-generation fence.

---

# 13. Error Handling

Execution MAY fail because of:

- validation errors
- authorization failures
- integrity failures
- storage failures
- cryptographic failures

Failures MUST leave Vault state unchanged.

---

# 14. Invariants

Commands are ephemeral.

Commands are never synchronized.

Commands never appear in the Event Log.

Commands never modify Projections directly.

Commands never bypass validation.

Transactions are atomic.

---

# 15. Future Compatibility

Future versions MAY introduce:

- additional Command types
- additional validation rules
- richer authorization models

Older runtimes SHOULD reject unsupported Commands rather than attempting partial execution.

---

# References

- event.md
- event-format.md
- protocol/protocol.md
