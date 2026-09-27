---
name: envoydev-ui-ux
description: >-
  Design and review EnvoyDev desktop UI — token reuse, toast vs in-place notice vs
  refusal strip, composer takeover / queue chrome, overlays, loading, and copy
  placement. Use when adding or changing product-visible GUI in apps/desktop, or
  when reviewing such a change.
---

# EnvoyDev desktop UI/UX

Judgment that lint and typecheck cannot make. Design authority:
[`docs/envoydev-ui.md`](../../../docs/envoydev-ui.md) and
[`docs/envoydev-ui-polish.md`](../../../docs/envoydev-ui-polish.md). Tokens:
[`docs/design-tokens.md`](../../../docs/design-tokens.md) /
`apps/desktop/src/design/tokens.css`.

**Do not** import DeepSeek Harness Cordis, slots, Remote mux, or `--dsw-*` variables.
Borrow judgment, not their stack or brand.

## Visual foundation

- **Use existing EnvoyDev tokens** for colour, radius, spacing, and type. Before a literal,
  find the nearest sibling page and reuse its token.
- **Verify light and dark** for every ink/background pair you touch.
- **Font sizes from the sheet** (`--font-size-*`). Parallel content shares one size; keep the
  number of sizes on a page small. Settings row titles may use content + semibold (600) as
  already recorded in `envoydev-ui.md` §3.1 — do not invent a second hierarchy.
- **Icons, text, and neighbours stay aligned** on one axis; icon size matches the text beside it.

## Reuse before adding

- Extend an existing component or interaction before creating a parallel one.
- Icon-only actions whose meaning is unclear get a Tooltip (or the existing title pattern).
- Composer / approval / toast: follow `envoydev-ui-polish.md` — do not invent a second dock.

## Feedback surfaces

Choose by **lifetime** of the message relative to the surface that produced it:

| Lifetime | Surface | Use for |
|---|---|---|
| Outlives closing Settings / sheet | Shell **toast** on `CoderApp` | Invite copied, dissolve ok, restart ok |
| Tied to the form / control | **In-place notice** beside the control | Validation, FixRunner failure |
| Must block work until read | Top **notice strip** | Pairing / app refusals |

- Toast state lives in the **shell**, not in a panel’s local state that unmounts with it.
- Toast reports success and failure; never still-pending.
- **A failed operation keeps the data visible.** Toast announces the failure; do not blank the row.
- Error copy is plain language and short. Headline first, detail second, developer last.

## Composer and approvals

- Send while running **queues**; show the queue status line. No Queue/Steer picker.
- Pending approval → **composer takeover** (`ApprovalTakeover`); transcript keeps history.
- Textarea stays **mounted but inert** across approval; do not unmount and lose the draft.
- Never a window-blocking permission modal.

## Loading

- Lists may use a skeleton; other page-level loads center a bare spinner.
- One loading treatment per region — concurrent regions must not each invent a style.

## Overlays and menus

Before merge, every menu / popover / tooltip:

1. **Dismissable** — outside click and Escape where focusable.
2. **Viewport-fitting** — stays inside the window with an edge margin.
3. **Unclipped** — portal past `overflow` ancestors when needed.

Respect existing Tauri titlebar clearance; do not change a global clearance variable to fix one page.

## Capability honesty

Never claim a control the agent’s `capabilities` (or harness summary) does not support.
Disabled with a reason beats hidden.

## Empty states

Empty states teach — title + one supporting sentence + at most one CTA group. No hero cards.
Composer stays present under an empty task transcript.
