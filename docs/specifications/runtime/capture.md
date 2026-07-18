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

- Vault ID
- status
- progress
- retries
- diagnostics

Jobs are ephemeral.

Jobs are never synchronized.

The Vault ID is fixed when the Capture Command is accepted. Later active-Vault changes MUST NOT reroute an accepted Capture Job. Job persistence, recovery, notices, outcomes, and diagnostics remain scoped to that Vault.

---

# 6. Capture Pipeline

The standard pipeline is:

1. Validate permissions
2. Run capability preflight
3. Freeze page state
4. Collect metadata
5. Stream mandatory MHTML into a prepared `PRIMARY` Artifact
6. Collect structured content and normalized text
7. Stream and stitch screenshot tiles, then derive a thumbnail
8. Prepare one independently encrypted Object per successful Artifact
9. Generate and encrypt the Bundle Descriptor
10. Validate the exact descriptor and Artifact dependency closure
11. Atomically persist records, Event, Projection, and command outcome
12. Publish one canonical invalidation after commit

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

The profile requests a lossy full-page WebP as a best-effort Artifact with Kind `IMAGE`, Role `SCREENSHOT_FULL`, and MIME type `image/webp`. MHTML remains the mandatory high-fidelity representation; the screenshot is a space-efficient visual preview.

The profile also requests a 640×360 WebP `THUMBNAIL`, canonical-CBOR-sequence
`CONTENT_STRUCTURED`, and normalized UTF-8 `TEXT_EXTRACTED`. These are best effort. Structured and
text outputs SHALL derive from the same acknowledged bounded live-DOM block stream.

Failure to produce the WebP SHALL record a typed warning but SHALL NOT invalidate otherwise valid required MHTML.

---

# 11. Screenshot

The Runtime SHOULD capture:

- viewport screenshot
- full-page screenshot (when supported)

Large pages MAY require stitched captures.

When the native-resolution bitmap exceeds the Host's safe canvas dimension, the Chrome Host SHALL retain the top-left region at native resolution up to 16,384 pixels on each axis, persist that valid partial screenshot, and record `SCREENSHOT_TRUNCATED`. It SHALL NOT discard an otherwise valid partial image or downscale it to fit.

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

# 13. Bundle Graph Generation

The Capture Service prepares every successful Artifact independently, then creates one compact
Bundle Descriptor referencing those Artifacts.

The descriptor SHALL describe every Artifact and SHALL contain no payload bytes.

The Bundle becomes immutable immediately after creation.

---

# 14. Persistence

Successful Bundles SHALL be written through the Storage Service.

The descriptor record, every Artifact record, `BundleRegistered`, Projection update, and command
outcome MUST commit atomically. Prepared wrapper files SHALL be removed if validation or commit
fails. Startup reconciliation SHALL remove unreferenced prepared files.

---

# 15. Events

Successful capture SHALL emit:

- BundleRegistered

`BundleRegistered` MUST include the assigned Collection ID. Before registration, the Runtime selects the newest Active Collection containing an exact fragmentless match for the captured URL, with query parameters significant and ascending Collection ID as the final tie-breaker. If none matches, it generates a new Collection ID. Hosts and storage Drivers MUST NOT decide this routing policy.

Failures MAY emit diagnostic Runtime Events.

Capture Jobs themselves are not synchronized.

---

# 16. Failure Recovery

Recoverable failures MAY retry individual pipeline stages.

Permanent failures terminate the Capture Job.

Partial authoritative Bundle graphs SHALL NOT be persisted.

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
