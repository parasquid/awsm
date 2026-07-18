# Restore Specification

**Document:** `specifications/portability/restore.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Restore System reconstructs a Vault from one or more Backup Sets.

Restore validates integrity before modifying persistent state. Every Restore operation executes as a Restore Job through the Runtime Job Framework.

---

# 2. Design Goals

Restore MUST provide:

- deterministic recovery
- integrity verification
- resumable execution
- idempotent execution
- partial recovery
- fault tolerance

---

# 3. Restore Model

Conceptually:

Backup Set

↓

Recovery Plan

↓

Restore Execution

↓

Verification

↓

Projection Rebuild

↓

Recovered Vault

---

# 4. Recovery Plan

Before restoration begins, the Runtime SHALL construct a Recovery Plan.

The plan SHALL determine:

- required Objects
- already available Objects
- missing Objects
- verification steps
- execution order

No persistent changes occur during planning.

---

# 5. Restore Modes

Supported modes include:

- Clean Restore
- Merge Restore
- Verify Only

Future modes MAY be introduced.

---

# 6. Clean Restore

Clean Restore reconstructs a Vault into an empty destination.

All required Objects SHALL be restored.

---

# 7. Merge Restore

Merge Restore imports Objects that are not already present.

Existing immutable Objects SHALL NOT be replaced.

Conflict handling is defined by the Event Model.

---

# 8. Verify Only

Verify Only validates:

- manifests
- checksums
- encryption envelopes
- object availability

Persistent state SHALL remain unchanged.

---

# 9. Restore Execution

Restore SHALL:

1. submit a Restore Job
2. verify Backup integrity
3. construct Recovery Plan
4. restore authoritative Objects
5. verify restored Objects
6. rebuild Projections and Materializations
7. resume Runtime services

---

# 10. Object Verification

Each restored Object SHALL be verified before becoming authoritative.

Objects failing verification SHALL be rejected.

---

# 11. Projection Rebuild

After successful restoration, the Runtime SHALL rebuild:

- search projections
- tag projections
- AI projections
- timeline projections

Projection rebuilding SHALL occur locally.

---

# 12. Encryption

Encrypted Objects SHALL remain encrypted throughout Restore.

Key availability SHALL be verified before restoration begins.

Restore SHALL NOT decrypt Objects unless required for validation.

---

# 13. Recovery Failures

Interrupted Restore operations SHALL be resumable.

Previously restored immutable Objects SHALL NOT be duplicated.

---

# 14. Diagnostics

The Restore System SHOULD expose:

- restore progress
- restored object count
- verification status
- estimated completion
- rebuild progress

---

# 15. Completion

Restore completes only after:

- all authoritative Objects restored
- verification succeeds
- Projections and Materializations rebuilt
- Runtime resumes normal operation

---

# 16. Invariants

Restore is idempotent.

Authoritative Objects remain immutable.

Verification precedes acceptance.

Projection and Materialization rebuilding never modifies authoritative Objects.

Restore execution is a Runtime Job.

---

# 17. Superseded Generations

Restore MUST compare the Backup Set's Vault Generation number and root ID with the target. A superseded generation MUST NOT merge into the active Vault. It may be restored only into an isolated retired generation or a new Vault for explicit manual recovery.

Vault Vacuum is not Backup destruction or cryptographic erasure; old Backup Sets and offline replicas remain outside its deletion boundary.

---

# References

- `docs/specifications/portability/backup.md`

- `docs/specifications/portability/import-export.md`

- `docs/specifications/storage/object-store.md`

- `docs/specifications/runtime/search.md`
