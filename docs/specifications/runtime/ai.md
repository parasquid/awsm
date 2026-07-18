# AI Service Specification

**Document:** `specifications/runtime/ai.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The AI Service generates derived artifacts from archived content.

The AI Service coordinates AI Providers but does not implement AI models itself.

Generated Artifacts become immutable derived data recorded by Runtime Events or Vault Events, depending on whether they remain local or synchronize.

---

# 2. Design Goals

The AI Service MUST provide:

- provider independence
- offline-first execution
- deterministic artifact storage
- resumable processing
- encrypted persistence
- extensibility

---

# 3. Architecture

```
Bundle

↓

AI Service

↓

AI Provider

↓

Derived Artifact

↓

Event or Object

↓

Projection Builder

↓

Search
```

The AI Service produces Artifacts.

Other Runtime components consume them.

---

# 4. Responsibilities

The AI Service SHALL:

- schedule AI Jobs
- invoke AI Providers
- collect outputs
- validate outputs
- package derived Artifacts
- emit completion events

The AI Service SHALL NOT:

- modify Bundles
- modify Search Projection Materializations
- update projections directly

---

# 5. AI Providers

Providers expose capabilities.

Examples include:

- Local LLM Runtime
- Remote LLM Service
- OCR Engine
- Image Captioning Engine
- Embedding Generator
- Language Detection Engine
- Translation Engine

Providers are interchangeable.

---

# 6. Provider Capabilities

Capabilities MAY include:

- Summarization
- OCR
- Image Description
- Keyword Extraction
- Entity Extraction
- Classification
- Embedding Generation
- Language Detection
- Translation
- Content Safety Classification

The Runtime requests capabilities rather than specific models.

---

# 7. AI Jobs

Every AI task SHALL execute as a Runtime Job.

Examples:

- Generate Summary
- Extract Keywords
- OCR Screenshot
- Generate Embeddings
- Detect Language
- Translate Document

Jobs SHALL be resumable.

---

# 8. Inputs

AI inputs MAY include:

- Bundle metadata
- HTML
- MHTML
- DOM snapshots
- extracted text
- screenshots
- user notes
- previous AI Artifacts

Inputs remain immutable.

---

# 9. Outputs

Outputs SHALL be stored as immutable Derived Artifacts.

Examples:

- Summary
- OCR Text
- Keywords
- Tags
- Entities
- Embeddings
- Image Captions
- Language Metadata
- Translation

Artifacts SHALL include provenance metadata.

---

# 10. Provenance

Every Derived Artifact SHALL record:

- generating capability
- provider identifier
- model identifier
- model version
- prompt version (where applicable)
- generation timestamp
- source Bundle identifier
- artifact schema version

This ensures generated content remains reproducible and auditable.

---

# 11. Encryption

Derived Artifacts SHALL be encrypted before persistence.

Encryption SHALL use the AI Domain defined by the Key Derivation Specification.

Plaintext SHALL NOT leave trusted clients unless explicitly permitted by user policy.

---

# 12. Privacy Policy

Provider policies determine where processing occurs.

Supported execution modes include:

- Local Only
- Remote Only
- Local Preferred
- User Selected

The Runtime SHALL expose provider selection to users.

---

# 13. Remote Providers

Remote providers MAY receive decrypted content only when explicitly authorized by user configuration.

The Runtime SHALL make the execution location visible to the user.

Zero-knowledge synchronization does not imply zero-knowledge AI processing.

---

# 14. Incremental Processing

The AI Service SHOULD avoid regenerating existing Artifacts.

Existing Artifacts MAY be invalidated when:

- provider changes
- model changes
- prompt version changes
- artifact schema changes
- user explicitly requests regeneration

---

# 15. Failure Handling

Recoverable failures SHALL be retried using the Runtime Job Framework.

Permanent failures SHALL produce diagnostic Runtime Events.

Failed AI Jobs SHALL NOT modify existing Artifacts.

---

# 16. Projection Integration

Completion of AI Jobs SHALL emit Runtime Events.

Projection Builders consume these events to update:

- search projections
- tag projections
- entity projections
- timeline projections

The AI Service does not directly update projections.

---

# 17. Diagnostics

The AI Service SHOULD expose:

- pending jobs
- completed jobs
- failed jobs
- provider availability
- execution time
- artifact generation statistics

Diagnostics SHALL NOT expose decrypted user content.

---

# 18. Future Extensions

Future capabilities MAY include:

- semantic clustering
- duplicate detection
- relationship extraction
- timeline generation
- citation extraction
- handwriting recognition
- audio transcription
- video analysis

---

# 19. Invariants

Bundles remain immutable.

Derived Artifacts remain immutable.

Providers are interchangeable.

Capabilities are versioned.

Artifacts are encrypted before persistence.

Projection updates occur only through Runtime Events.

---

# References

runtime.md

jobs.md

search.md

`docs/specifications/crypto/key-derivation.md`

`docs/specifications/bundle/bundle.md`
