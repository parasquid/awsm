# Library-Centered Vault Rename

**Document:** `docs/plans/04-library-centered-vault-rename.md`
**Status:** Approved
**Depends On:** `docs/plans/03-multiple-vault-management.md`

## Goal

Keep the capture popup deliberately minimal and make Vault renaming a lightweight, contextual
Library interaction tied directly to the active Vault's title.

## Required Behavior

- The popup shows the active Vault, lock state, and switching controls, but no Rename action.
- The Library's primary heading is the active Vault name, replacing `Your local library`.
- When the active Vault is unlocked and management is idle, its heading is an accessible button
  styled as title text. Activating it replaces the title with exactly one inline name input and a
  `Rename` button. This interaction never opens a dialog.
- The visible input has a separate screen-reader-only label connected by `for` and `id`; the input
  itself MUST NOT be contained by assistive-only markup.
- The input is prefilled, mounted, focused, and fully selected. Native selection highlighting is
  the overwrite feedback, and the first typed character replaces the complete current name. Enter
  or `Rename` submits the existing atomic `RenameVault` request.
- Clicking or moving focus outside the form, or pressing Escape, discards the draft and restores
  the authoritative name. There is no Cancel button.
- Invalid input remains in edit mode with an adjacent error. A successful Rename restores the
  heading, announces the canonical returned name, and returns focus to the title control.
- Locked or busy Vault names are noninteractive. A Vault context change discards any draft and
  renders the new authoritative state.
- An open Library reacts without reload to lock, unlock, active Vault, name, Capture busy/completion,
  Library content, and Vacuum state changes. Notifications invalidate local UI; the Library clears
  context-bound plaintext and refetches canonical Runtime state.
- The Library management bar does not repeat the Vault name; it retains lock/busy status, Switch,
  and Create controls.

## Visual Contract

- Header, Vault-management row, and Library content share the centered
  `min(1050px, calc(100% - 40px))` content grid. At widths up to 480 px they share a 14 px viewport
  inset. No management control begins at the viewport edge.
- Display and edit states occupy the same header title slot. They share the title's left edge,
  serif scale, weight, line height, and vertical center; entering edit mode does not move the header
  rule or Library content.
- The resting title button has no visible border, background, margin, or padding. Hover and keyboard
  focus may underline it, and keyboard focus retains the established visible focus ring.
- The edit form uses component-scoped layout rather than generic form spacing. The visible input is
  border-box, has a restrained 3 px vertical and 8 px horizontal inset, and remains within the
  viewport. The compact `Rename` button sits directly beside it and is vertically aligned.
- While submission is pending, the action reads `Renaming…`, is disabled, uses reduced emphasis,
  and retains the edit geometry.
- The management row uses a 16 px top inset, a 10 px by 16 px wrapping gap, and no inherited action
  margin. Lock state and actions share one row where space permits and wrap without clipping on a
  narrow viewport.
- Validation feedback appears beneath the edit row with compact spacing and does not change the
  horizontal alignment of the title or management row.

## Implementation Boundaries

This changes presentation and interaction only. It does not change the Rename Command, Event,
Projection, encrypted cache, persistence, or protocol contracts. The canonical pre-release format
remains the only format; no compatibility behavior is introduced.

## Verification

- Prove the popup exposes no Rename control.
- Prove the Library heading uses the active Vault name and exposes one accessible edit target only
  while unlocked and idle.
- Prove repeated activation cannot create multiple editors.
- Prove click-away and Escape discard, while Enter and `Rename` save exactly once.
- Prove invalid input stays editable and context changes discard stale drafts.
- Assert the input is visible and the native selection spans the complete current value.
- Assert header, management row, and main content have the same left edge; editing does not move the
  header rule or main content; and neither desktop nor 390 px layouts overflow horizontally.
- Capture and inspect 1280x800 and 390x844 screenshots for resting, focused/selected editing,
  validation error, restored, success, locked, and narrow wrapped states. Tests that only prove DOM
  existence are insufficient.
- Run unit, IndexedDB integration, typecheck, lint, build, and packaged Chrome E2E gates.
