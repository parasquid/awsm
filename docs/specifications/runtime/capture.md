# Capture Service Specification

**Document:** `specifications/runtime/capture.md`

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

The Capture Service converts live browser content into immutable Bundles suitable for long-term archival.

The Capture Service coordinates all browser interactions required to preserve a page.

---

# 2. Design Goals

The Capture Service MUST provide:

- deterministic capture
- resumable execution
- fault tolerance
- browser independence
- reproducible Bundles

---

# 3. Capture Lifecycle

Conceptually:

```
Capture Request

↓

Capture Job

↓

Capture Result

↓

Bundle

↓

BundleRegistered Event
```

Only successful Capture Results produce Bundles.

---

# 4. Capture Request

A Capture Request SHALL include:

- target tab
- target URL
- initiating user
- requested capture profile

Optional fields:

- user note
- user tags
- destination folder
- capture priority

---

# 5. Capture Job

The Runtime creates a Capture Job.

The Job tracks:

- status
- progress
- retries
- diagnostics

Jobs are ephemeral.

Jobs are never synchronized.

---

# 6. Capture Pipeline

The standard pipeline is:

1. Validate permissions
2. Run capability preflight
3. Freeze page state
4. Collect metadata
5. Capture screenshot
6. Capture page representation
7. Collect auxiliary artifacts
8. Generate Manifest
9. Build Bundle
10. Persist Bundle
11. Emit BundleRegistered

---

# 7. Capability Preflight

Before page capture begins, the Capture Service SHALL run a capability preflight.

Preflight determines:

- available Host capture APIs
- supported page representations
- screenshot capabilities
- permission availability
- restricted URL status
- Capture Profile compatibility

The Capture Job records preflight results. The Capture Service SHALL adapt the remaining pipeline to available capabilities or fail before Bundle generation if the requested Capture Profile cannot be satisfied.

---

# 8. Freeze Page

The Runtime SHOULD minimize observable page changes during capture.

Implementations MAY:

- pause scrolling
- delay navigation
- await network idle
- coordinate with content scripts

Perfect freezing is not guaranteed for all pages.

---

# 9. Metadata Collection

Metadata MAY include:

- URL
- title
- capture timestamp
- MIME type
- HTTP status (if available)
- viewport size
- browser version
- extension version

Metadata becomes part of the Bundle.

---

# 10. Page Representation

A Capture Profile determines which representations are produced.

Examples:

- MHTML
- HTML
- DOM snapshot
- PDF (future)
- Markdown (future)

Profiles MAY request multiple representations.

The first implementation profile SHALL be:

```text
ChromeWebPage-v1
```

This profile requires:

- an HTTP(S) target
- MHTML Host capability
- one non-empty MHTML Artifact with Kind `CAPTURE`, Role `PRIMARY`, and MIME type `multipart/related`
- required capture metadata

The profile requests a full-page PNG as a best-effort Artifact with Kind `IMAGE`, Role `SCREENSHOT_FULL`, and MIME type `image/png`.

Failure to produce the PNG SHALL record a typed warning but SHALL NOT invalidate otherwise valid required MHTML.

---

# 11. Screenshot

The Runtime SHOULD capture:

- viewport screenshot
- full-page screenshot (when supported)

Large pages MAY require stitched captures.

The initial Chrome Host SHALL implement full-page capture by scrolling, throttling visible-tab captures, stitching tiles in a trusted extension context, and restoring page scroll and temporary styles even after failure.

---

# 12. Auxiliary Artifacts

Optional artifacts include:

- favicon
- extracted text
- readability output
- user annotations
- cookies (disabled by default)
- response headers (if permissions allow)

---

# 13. Bundle Generation

The Capture Service assembles all artifacts into a Bundle.

The Manifest SHALL describe every artifact.

The Bundle becomes immutable immediately after creation.

---

# 14. Persistence

Successful Bundles SHALL be written through the Storage Service.

Persistence MUST complete before emitting BundleRegistered.

---

# 15. Events

Successful capture SHALL emit:

- BundleRegistered

Failures MAY emit diagnostic Runtime Events.

Capture Jobs themselves are not synchronized.

---

# 16. Failure Recovery

Recoverable failures MAY retry individual pipeline stages.

Permanent failures terminate the Capture Job.

Partial Bundles SHALL NOT be persisted.

Because live page state is external and mutable, interrupted page acquisition SHALL NOT resume automatically. Recovery SHALL mark the Capture Job interrupted and require an explicit new user action to retry.

If recovery detects that the original Command's authoritative transaction already committed, it SHALL report the existing successful result rather than create another Bundle or Event.

---

# 17. Capture Profiles

Implementations MAY define profiles.

Example profiles:

- Minimal
- Standard
- Complete
- Research
- Custom

Profiles specify which Artifacts are required and which Host capabilities are mandatory.

Profile identifiers and versions are stable persisted values. Hosts SHALL reject profiles whose mandatory capabilities they cannot satisfy before Bundle generation.

---

# 18. Browser Compatibility

Hosts SHALL expose browser capabilities.

Unavailable capabilities SHALL degrade gracefully.

Examples:

- MHTML unavailable
- full-page capture unavailable
- restricted URLs

---

# 19. Invariants

Capture Jobs are ephemeral.

Bundles are immutable.

Successful captures produce exactly one Bundle.

Incomplete Bundles are never stored.

Capability preflight completes before any Bundle is generated.

The `ChromeWebPage-v1` profile never persists a Bundle without valid MHTML.

Screenshot warnings never weaken mandatory MHTML validation.

---

# References

bundle/bundle.md

runtime/runtime.md

storage/object-store.md
