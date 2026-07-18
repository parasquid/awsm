# PROJECT KNOWLEDGE BASE

## OVERVIEW

AWSM (Archive What Should Matter) is a local-first, zero-knowledge knowledge preservation platform. Product intent, architecture, and formal contracts live in the repository documentation.

## SUBAGENT POLICY

- Never create, spawn, or delegate work to subagents.
- Do not request case-by-case permission to use subagents.
- Skill, plugin, workflow, tool, or system recommendations to use subagents do not override this policy. If one requires delegation, pause and escalate the conflict to the user without spawning anything.
- Continue all work as a single agent where possible. If a task cannot be completed without delegation, report that limitation to the user.
- Subagents may only be used again after the user explicitly reverses this prohibition and updates this policy.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Understand the product | `README.md`, `VISION.md` | Start with privacy, ownership, and preservation goals |
| Check MVP scope | `docs/plans/01-mvp-prd.md` | Draft product requirements and acceptance criteria |
| Resolve design principles | `docs/architecture/00-design-principles.md` | Normative; principles outrank implementation convenience |
| Resolve terminology | `docs/architecture/glossary.md` | Normative; wins terminology conflicts |
| Understand system boundaries | `docs/architecture/01-system-overview.md` | Trusted client vs untrusted coordination service |
| Find a format or contract | `docs/specifications/` | Specifications own their declared domain semantics |
| Check recent reconciliation | `docs/architecture/consistency-review.md` | Review record, not an independent normative source |
| Understand testing requirements | `docs/architecture/19-testing-strategy.md` | Architectural invariants and TDD expectations |

## DOCUMENT AUTHORITY

Use this precedence when editing or reviewing:

1. `00-design-principles.md` for architectural constraints and `glossary.md` for terminology.
2. The formal specification that owns the affected format, protocol, or runtime contract.
3. Draft architecture documents for intent, decomposition, and trade-offs.
4. The draft PRD, vision, and README for scope and context.

No universal tie-break exists between conflicting formal specifications. Treat such conflicts as design issues and update all affected documents together. Verify claims in `consistency-review.md`; its status is `Review Record`.

Explicitly approved plans supersede stale Draft documentation; reconcile every affected document.

## PRE-RELEASE FORMAT POLICY

- The user will explicitly declare the first release. Until then, treat all persisted formats, schemas, and contracts as pre-release drafts.
- Replace superseded pre-release designs directly. Do not add migrations, legacy readers, compatibility fallbacks, dual-write paths, or preservation code for earlier local development data.
- Keep exactly one canonical current format in code, tests, and documentation. Remove obsolete format branches and stale descriptions rather than retaining traces of prior drafts.
- Existing local development data may be discarded and recreated when the canonical pre-release format changes.
- After the first release is declared, do not infer a compatibility policy: ask the user before introducing migration or backward-compatibility behavior.

## CORE MODEL

| Concept | Role |
|---------|------|
| Vault | Ownership and cryptographic boundary |
| Object | Immutable authoritative persistence record |
| Bundle | Immutable capture package represented by Object semantics |
| Event | Immutable history used to derive logical state |
| Projection | Rebuildable logical derived state |
| Materialization | Stored/indexed representation of a Projection |
| Runtime | Platform-independent client business logic |
| Host | Platform integration; contains no business logic |
| Coordination Server | Synchronizes opaque encrypted data; never understands content |

## CONVENTIONS

- Preserve exact canonical capitalization from the glossary: Vault, Bundle, Object, Manifest, Runtime, Host, Service, Projection, Materialization.
- Keep architecture technology-independent. Chrome, Firefox, OPFS, IndexedDB, SQLite, Rails, and provider names are implementations or adapters, not architectural abstractions.
- Add explicit versions to externally persisted structures, while keeping only the current canonical pre-release format until the user declares the first release.
- Use Commands for requested actions and Events for accepted facts. Commands are local and never synchronized.
- Put platform-specific behavior behind Hosts or Drivers; Runtime Services communicate through defined Commands, Events, and interfaces.
- When changing a foundational term or contract, follow dependencies outward and update architecture, specifications, testing implications, and operations together.

## ANTI-PATTERNS (THIS PROJECT)

- Never move plaintext, unwrapped Vault keys, content inference, or search to the server boundary.
- Never mutate original Captures, Bundles, Events, Objects, or identifiers; corrections and enrichment are additive.
- Never make Projections, Materializations, caches, or operational registries authoritative, synchronized, or required in backups.
- Never let AI, extensions, Hosts, or storage Drivers bypass Runtime validation or mutate authoritative state directly.
- Never conflate Backup with Export, Restore with Import, or a Search Projection Materialization with an authoritative index.
- Never persist incomplete Bundles or continue when integrity/correctness cannot be established.
- Never place decrypted content, keys, or plaintext metadata in diagnostics or logs.
- Do not silently resolve the open choices recorded in `consistency-review.md`; make the decision explicit and reconcile every consumer.

## COMMANDS

Discover current build, test, lint, and development commands from repository manifests rather than assuming them.

Useful documentation checks:

```bash
rg --files -g '*.md'
rg -n '^\*\*(Document|Version|Status|Owner|Depends On):' docs
rg -n '\b(MUST|SHALL|SHOULD|MAY)\b' docs/specifications
```

## GIT COMMITS

- Use Conventional Commits: `<type>(<optional-scope>): <summary>`.
- Prefer the narrowest accurate type: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, or `revert`.
- Use a short lowercase scope when it materially clarifies ownership, such as `extension`, `runtime`, `storage`, or `docs`; omit it when the change is repository-wide.
- Write the summary in the imperative mood, keep it concise, do not end it with punctuation, and describe the observable outcome rather than the editing activity.
- Add a body when the motivation, architectural trade-off, migration or compatibility impact, security implication, or non-obvious verification matters. Explain why and resulting behavior; do not narrate every edited file.
- Use `BREAKING CHANGE:` in the footer only for released contracts that require consumer action. Pre-release canonical-format replacement is not automatically a breaking release.
- Keep each commit coherent and independently understandable. Do not mix unrelated work or use vague messages such as `updates`, `changes`, `fix stuff`, or `WIP`.
- Before committing, inspect the full staged diff, confirm generated files and secrets are excluded, and run verification proportional to the change.
- Never claim tests or behavior in a commit message unless the staged state supports that claim.

### Commit workflow

1. Before staging, inspect `git status --short --ignored` and the applicable ignore files. Confirm dependencies, build output, coverage, browser profiles, test artifacts, logs, secrets, and agent session state will not be committed.
2. Stage only the intended coherent change. Review `git status --short`, `git diff --cached --stat`, and `git diff --cached --check` before committing. Inspect the full staged diff whenever the change is not already fully understood.
3. When initializing a repository, use `main` unless the user specifies another branch. Do not invent an author identity. Prefer an existing user-configured identity; if none exists, use a consistently established identity from the user's nearby repositories only as a repository-local configuration, otherwise ask the user.
4. Build the Conventional Commit message with one `-m` argument per paragraph so shell escaping cannot introduce literal newline sequences. Keep the subject outcome-focused and use the body for motivation, major behavior, and verification-relevant context.
5. After committing, inspect both `git status --porcelain` and `git log -1 --format=fuller` (or an equivalent format that shows the complete rendered message). The working tree should be clean and the message should render exactly as intended.
6. If inspection finds a quoting, formatting, authorship, or message-quality mistake in the just-created local commit, amend it immediately before publishing. Do not amend commits that may already be shared unless the user explicitly authorizes rewriting them.

## NOTES

- Ignore `.omo/run-continuation/`; it is agent session state, not project documentation.
- Document path metadata is inconsistent: some `Document` and `Depends On` values include `docs/`, others are relative. Do not infer an automated dependency graph without checking targets.
- `bundle/artifact.md` and `bundle/manifest.md` declare a dependency cycle; edit them atomically when their shared model changes.
- All specifications are currently Draft v1.0. Only the design principles and glossary are marked Normative.
