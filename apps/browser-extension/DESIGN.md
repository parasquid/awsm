# Browser Extension UI Design

The extension uses a quiet archival-tool aesthetic: warm paper background, dark green primary actions, serif headings, and compact system typography. It uses no UI framework. Network access is optional, limited to the exact user-approved Coordination Server origin, and carries only Account authentication material and opaque encrypted synchronization data.

The popup is a 360 px task surface with explicit onboarding, locked, capturing, success, warning, and failure states. Capture continues in the background if the popup closes. Reopening the popup derives its state from the persisted Runtime job.

The library is a full extension page. The list contains title, source URL, capture time, screenshot availability, and warnings. Detail content is decrypted only after unlock. Screenshots may be displayed through short-lived Blob URLs. MHTML is offered only through an anchor with a `download` attribute; it is never assigned to a frame, object, embed, window location, or executable document surface.

Vault-level maintenance follows the Library content in a lightly elevated green-tinted panel. Reversible storage relief uses the primary green action and calm blue progress treatment; permanent Vault Vacuum remains visually separated and uses the existing destructive treatment. Remote-only Artifacts retain normal semantic actions and gain a blue text status explaining that opening retrieves them from the server. Progress, waiting, cancellation, success, partial-skip, and failure states remain in place without moving surrounding Library content.

All controls are keyboard reachable, use native semantics, retain visible focus, and report asynchronous state through polite live regions. Color is never the only status signal. Motion is nonessential and reduced-motion preferences are honored.
