# What we take from Paseo's design, and where we deliberately differ

Companion to [`design-tokens.md`](design-tokens.md): that file carries the *values*, this one the
*behaviour*. Both exist because we adopt Paseo's design, not its code — and a design includes its
interaction logic, so it has to be written down somewhere a reviewer can check. Citations are Paseo
v0.8.0 (Apache-2.0); our own files are named where a decision lands.

## Adopted, because it is right

| Decision | Why, from Paseo's own code |
|---|---|
| **Queueing is the default send, with one forced exception** | Their default is `steer`; but `resolveActiveSendBehavior(sendBehavior, hasPendingPermission)` forces `interrupt` whenever an approval is pending (`composer/input/state.ts:8-13`), because *"queueing behind a permission prompt would strand the message: the turn is parked until the request is answered"*. Copy the exception, not just the default. |
| **The composer cannot be submitted into a dead end** — an empty prompt with no attachments is a legitimate action | `isSubmitDisabled` tracks only loading/upload; validation happens in the destination, first failure wins (`provider-selection.ts:315-352`). We keep the *shape* (validate where the work happens), and we will show the reason there rather than disabling a button with no explanation. |
| **Selection is a background tint, not an indicator**; a tab strip has no underline | `surface-2` + `foreground` label (see `design-tokens.md` §"Rules"). |
| **Two status bands** — dot colours are louder than icon/badge colours | a 6px dot has no label beside it. |
| **Approvals appear inline in the timeline**, not as a modal | the card scrolls with the transcript (`agent-stream/view.tsx:113-134`), so the context that produced the question stays visible — this is what a control plane should do. |
| **A question and a plan get their own UI; tool/mode/other share one generic card** | three shapes, not six (`:1518-1597`), with title fallback `title ?? name ?? "Permission Required"`. |
| **Dictation appends to the *end* of the draft with one separating space** — never at the caret, never replacing a selection; streaming partials are read and discarded | `composer/input/state.ts:69-72`, pinned by their tests. Inserting at the caret is the naive version and it feels wrong. |
| **Status-ring geometry is derived, not literal**: ring = dot 6 + (gap 1.5 + stroke 1.5) × 2 = 12, frame = ring + halo inset × 2 = 14 | `status-ring/geometry.ts:6-20`. Deriving it is what keeps a redesign from leaving the ring the wrong size. |

## Refinements we will make *after* parity

Strategy, restated: **copy Paseo's UI, UX and style first, then refine.** The items below are therefore not
divergences we ship from day one — they are the improvements queued behind a faithful copy. The single
exception is the honesty class (never offer a control we cannot honour), which applies immediately.

The full feature backlog and copy order is in [`paseo-feature-parity.md`](paseo-feature-parity.md).

1. **Pane shortcuts must work on Windows and Linux.** In Paseo every pane binding — split, focus, move,
   close — carries `when: { mac: true }` with **no non-mac counterpart** (`keyboard-shortcuts.ts:712-835`),
   so a Windows or Linux user has no keyboard route to split or move a pane at all. We are React + Tauri,
   not mac-first: ours ship both, and `Mod` means what the platform says it means. (Their own bindings
   never use `Mod`, and they have **no conflict detection** — first declaration wins, so a user override
   can silently shadow a default at `:1419-1421`. Ours will report a conflict.)
2. **"Remember this approval" is our design to make, not theirs to copy.** Paseo has *no* app-side
   allowlist: no session/project/global store, no storage key; `updatedPermissions` exists on the wire and
   the app never sends it (`agent-stream/view.tsx:1491-1505`). "Always allow" is a provider-supplied
   button (`acp-agent.ts:3779-3783`). Their pending requests are memory-only — deliberately excluded from
   the persisted replica cache (`replica-cache/index.ts:245`). Since we are the control plane and the
   answer may arrive from the phone, we need a real, revocable, scoped grant — the same shape as our
   product sessions. **This is new work, listed as such.**
3. **A denial can carry a reason.** Theirs is the hardcoded literal `"Denied by user"` with no input
   (`view.tsx:1504`). A decline that cannot say *why* is a worse review loop, and agents can act on the
   reason.
4. **Sidebar status labels come from our own copy.** Paseo's group labels — `Needs input / Failed /
   Ready to review / Working / Done` — are **hardcoded English and absent from their i18n catalog**
   (`hooks/sidebar-status-view-model.ts:8-14`), so they do not translate in the shipped app. We keep the
   wording (it is good) and keep it translatable.
5. **The create flow can be idempotent, so ours will be.** Paseo's has two phases — write a pending store
   and let a draft tab consume it, or (if the user navigated away) call `create_agent` directly — with an
   explicit invariant that the *store write is the dedupe mechanism* (`background-handoff.ts:38-54`),
   because the daemon does not dedupe `create_agent` by `clientMessageId`. We already carry
   `clientMessageId` in our own protocol: ours dedupes at the daemon and the two-phase handoff disappears
   along with the class of bug it guards.
6. **The model row stays minimal, and the meter does the rest.** Their picker row is
   `{favoriteKey, provider, providerLabel, modelId, modelLabel, description, isDefault}` — no context
   size, no price, no capability tags, even though `contextWindowMaxTokens` is on the type and never read
   (`provider-selection.ts:13-22`); context and cost live in a separate ring. We keep the separation and
   will show the two facts a user actually chooses on: context size and cost, per model.
7. **`0` is not a status.** Their `done` bucket renders a muted dot when `showDoneAsInactive` is set, used
   at exactly two call sites. Ours simply renders nothing for done, so "nothing there" always means the
   same thing.

## Not applicable to us at all

* **The RN/unistyles plumbing** (`withUnistyles`, `StyleSheet.create`, `data-pmono` font hacks, the
  `Platform.select` splits, the build-time check that forbids reading a style object at module scope).
  Our tokens are CSS custom properties; that whole class of problem does not exist here.
* **Their six dark variants and the font ramp** — recorded with values in `design-tokens.md` under
  "Recorded but not shipped", so the work is not lost when we add a theme picker.
* **Their logical-Session / physical-socket model** (one persisted `clientId`, the daemon fanning one
  Session to a set of sockets: `websocket-server.ts:1622`, `:1240-1242`). Our windows each hold their own
  connection and subscription set, which is *stronger* isolation — and it is also why
  `CoderStateChange.origin` (declared, never set) is worth implementing: with per-window connections, the
  origin of a change is knowable, and a window can then skip work it caused itself.

## Not yet wired: two items with a plan, not a patch

Both of these are *design* decisions that cross the wire, the daemon and the UI at once. They are
written here so the next person does not have to rediscover the shape — and so nobody mistakes them
for something a one-line fix can close.

### 1. The 38-entry ACP catalogue is data with no door

`packages/agent-catalog/src/acp-catalog.ts` holds the catalogue (id, title, description, version,
install link, command, `env`, `params`) with provenance and tests. **Nothing can reach it.** Three
things are missing, in the order they have to happen:

1. **An id space that can hold a name we did not compile in.** `HarnessId` is a closed union
   (`packages/protocol/src/domain.ts`) and `HarnessIdSchema` is a `z.enum` over it, so `coder.startRun`
   for `gemini` is rejected by the schema before any handler sees it. Paseo's equivalent is an open
   `AgentProvider = string` (`packages/protocol/src/agent-types.ts:3`) with validation at the provider
   config boundary. **The decision to make:** either add the catalogue ids to the union (simple, but a
   release per agent) or adopt an open id with a registered-provider table (paseo's choice; needs a
   config file and a validation boundary). Our `CoderPaths` (`packages/host-bridge/src/index.ts`) has no
   provider file yet, so this is also where a user's `command`/`env` overrides would live.
2. **The RPCs.** A read (`coder.listAgents` — the union of built-in, catalogued and user-registered,
   each with its probe result and install link) and a write for user-defined providers
   (`coder.addProvider` / `coder.removeProvider`), validated with the same id regex Paseo uses
   (`^[a-z][a-z0-9-]*$`) and refusing a derived provider without a command. `coder.listHarnesses`
   already exists and returns the closed set; this would be a superset, not a second answer.
3. **The transport that makes them run.** Today `isDrivableByAcpAdapter()` is true for exactly two
   entries; the rest are recorded as `cli` and refused by name. Listing them before an adapter exists
   would recreate the very bug we just fixed — a menu that offers what cannot start. **So the order is:
   adapter first, listing second**, or a listing that says plainly "not supported yet, needs an adapter"
   and cannot be launched.

### 2. The shell cannot create a second window

The daemon half is done and tested (many connections, per-connection subscriptions, `coderStore` is one
per window). What is missing is window *creation*, and it is four small pieces:

| Piece | Where | What |
|---|---|---|
| Window config | `apps/desktop/src-tauri/tauri.conf.json` | the single declared window has no `label`; a second window needs either a label convention or per-window config |
| Permission scope | `apps/desktop/src-tauri/capabilities/default.json` | scoped to `windows: ["main"]` — a new window label outside that list gets no permissions |
| A command | `apps/desktop/src-tauri/src/main.rs` (`invoke_handler!`) | a `new_window` command building a `WebviewWindow` on the same URL; the daemon needs no change because the window resolves its endpoint from the shell |
| An affordance | the Command Center registry (`apps/desktop/src/components/CommandCenter.tsx`) | a command entry plus the shortcut, which for us means **both** the mac and non-mac binding — paseo's pane/window shortcuts are mac-only, and that is a gap we chose not to inherit |

Passing state to the new window (which task it should show) is the part worth designing rather than
copying: our windows each hold their own connection, so a window can be told its initial selection
without a daemon-side change — and `CoderStateChange.origin` (declared, never set) is what would let a
window skip the refetch it caused itself.
