# Runtime Job Framework Specification

**Document:** `specifications/runtime/jobs.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Runtime Job Framework provides durable execution of long-running operations.

It is responsible for scheduling, persistence, retries, progress reporting, cancellation, and recovery.

Application services define Job Types.

The Job Framework executes them.

---

# 2. Design Goals

The Job Framework MUST provide:

- durable execution
- resumable execution
- retries
- prioritization
- cancellation
- deterministic state transitions

---

# 3. Architecture

```
Service

↓

Job Scheduler

↓

Job Repository

↓

Worker

↓

Completion
```

Services submit Jobs.

Workers execute Jobs.

The Scheduler coordinates execution.

---

# 4. Job Types

Standard Job Types include:

- Capture Job
- Synchronization Job
- AI Job
- Projection Job
- Garbage Collection Job
- Vault Vacuum Job
- Import Job
- Export Job
- Backup Job
- Restore Job

Future Job Types MAY be introduced.

---

# 5. Job Structure

Every Job SHALL contain:

- Job ID
- Job Type
- Job Version
- Creation Time
- Current State
- Priority
- Payload

Optional fields:

- Parent Job
- Correlation ID
- Retry Count
- Progress

---

# 6. Job States

Jobs transition through:

```
Created

↓

Queued

↓

Ready

↓

Running

↓

Succeeded
```

Alternative terminal states:

```
Running

↓

Failed
```

```
Running

↓

Cancelled
```

Retryable failures:

```
Failed

↓

Retry Waiting

↓

Queued
```

---

# 7. Scheduler

The Scheduler SHALL:

- select runnable Jobs
- respect priorities
- respect dependencies
- avoid duplicate execution

---

# 8. Workers

Workers execute Jobs.

Workers SHALL:

- report progress
- report completion
- report failure

Workers SHALL NOT manage retries.

---

# 9. Priorities

Suggested priorities:

- Critical
- High
- Normal
- Low
- Background

Scheduling policy is implementation-defined.

---

# 10. Dependencies

Jobs MAY depend upon other Jobs.

Dependent Jobs SHALL remain blocked until prerequisites complete successfully.

Job dependencies form a directed acyclic graph. The MVP MAY execute the graph sequentially, but the dependency model SHALL remain explicit.

Example:

```
Capture

↓

Encrypt Bundle

↓

Store Bundle

↓

Synchronize Bundle
```

---

# 11. Progress

Jobs MAY expose progress.

Progress SHOULD be monotonic.

Progress reporting SHALL NOT affect Job correctness.

---

# 12. Retries

Retry policy SHALL include:

- retry limit
- delay strategy
- retry reason

Permanent failures SHALL terminate the Job.

---

# 13. Cancellation

Jobs MAY be cancelled.

Cancellation SHALL leave persistent state consistent.

Completed Jobs cannot be cancelled.

---

# 14. Persistence

Job state SHALL survive Runtime restarts.

Restarting the Runtime SHALL restore pending Jobs.

---

# 15. Recovery

The Scheduler SHALL detect interrupted Jobs.

Interrupted Jobs SHALL return to an executable state unless explicitly marked unrecoverable.

Live browser page acquisition is explicitly non-resumable because the external page may have changed. An interrupted Capture Job SHALL be marked Failed and require a new user-initiated Capture Command.

Capture recovery SHALL first check the original Command outcome. If the authoritative transaction committed before interruption, recovery SHALL mark the Job Succeeded without emitting another Event. Otherwise no partial Bundle or Event may exist.

---

# 16. Events

Job lifecycle events MAY include:

- JobQueued
- JobStarted
- JobProgress
- JobSucceeded
- JobFailed
- JobCancelled

These are Runtime Events.

They are not synchronized between replicas.

---

# 17. Diagnostics

The Job Framework SHOULD expose:

- queue depth
- running jobs
- retry counts
- execution times
- worker utilization

---

# 18. Invariants

Jobs are durable.

Workers are stateless.

Schedulers are deterministic.

Retries are centrally managed.

Services define behavior.

The Job Framework defines execution.

---

# References

- `docs/specifications/runtime/runtime.md`
- `docs/specifications/runtime/synchronization.md`
- `docs/specifications/runtime/capture.md`
- `docs/specifications/portability/backup.md`
- `docs/specifications/portability/restore.md`
