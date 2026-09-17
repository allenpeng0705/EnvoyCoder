# What EnvoyDev takes from Paseo

**Source studied:** `../paseo`, v0.8.0 · **Licence:** Apache-2.0 with a preamble excluding
third-party components (`LICENSE:1-9`) · **Position of this document:** we reimplement ideas and UX;
we do not copy code.

---

## 1. The licensing position, stated precisely

Paseo is Apache-2.0 with a non-standard preamble: third-party components keep their own licences, and
everything else is Apache-2.0. Two sub-trees are **MIT**, and they are exactly the "third-party
components" the preamble carves out: `packages/expo-two-way-audio/**` and
`packages/highlight/src/astro/**`. There is **no `NOTICE` file** in the repo, so Apache-2.0 §4(d) —
propagate the NOTICE — is not triggered by anything upstream.

What that means for us, in practice:

* **Reimplementing ideas, information architecture, protocol *shapes*, and UX is not constrained by
  copyright.** The sidebar model, the normalised tool-call union, the daemon/clients split, the
  composer's Queue/Steer distinction — all safe to reimplement, and that is what this repo does.
* **Copying source files would be constrained**: retain the licence text, retain copyright and
  attribution notices in the copied files, state prominently that we changed them, and ship a copy
  of the licence. We are not doing that in the scaffold, and a future change that does must add the
  attribution in the same commit.
* **Trademark is separate and not granted**: no "Paseo" name, logo, or `paseo.sh` in user-facing
  surfaces. Nothing in this repo references them as a brand; the docs name the project only to say
  where an idea came from.
* **Flagged upstream for their own review, not ours to reuse blindly:** the voice stack bundles
  Sherpa/Silero/Parakeet assets with no in-tree attribution. We do not reuse the voice stack.

## 2. What we take: the architecture

| Paseo | Ours | Why it is right |
|---|---|---|
| A local **daemon** owns agents and state; clients connect to it (`packages/server`, `packages/protocol`) | `apps/desktop/src/daemon/` + `@envoydev/protocol` | the only shape in which closing a window does not kill a running agent |
| **Normalised streaming**, not passthrough: an event union for turns, tool calls, usage, permissions (`agent-sdk-types.ts:419-475`) | `RUN_EVENT_KINDS` in `@envoydev/protocol` | a client renders a transcript and a diff; only the daemon knows which harness produced them |
| **Tool calls as a tagged union** — `shell \| read \| edit \| write \| search \| fetch \| sub_agent \| plan \| unknown` (`packages/protocol/src/agent-types.ts:201-295`) | to be adopted in `packages/protocol` when the first run lands | this is what makes a rich diff panel possible at all, and `unknown` is the honest escape hatch |
| **Provider abstraction as a contract**, not a switch: `AgentClient` + `AgentSession` with capabilities (`agent-sdk-types.ts:660-803`) | `@envoydev/agent-catalog` | the catalogue is data; the adapter is code. Capabilities decide what the UI may promise |
| **Three registration paths**: in-tree, config-only `extends`, plugin SDK | catalogue entry now; config-only later | a user who wants a provider we do not ship should not need to fork |
| **Capability-gated, append-only wire protocol** (`packages/protocol/src/client-capabilities.ts`) | versioned protocol from day one | a phone and a desktop update on different days |
| **Attention model**: `finished \| error \| permission`, with a status-bucket priority | `needs-attention` as its own status | "waiting on a human" is not "running"; burying it is how a control plane makes users wait on it |

## 3. What we take: the UX

* **The composer** is the whole prompt surface, with **Queue vs Steer** as an explicit control: a
  follow-up either waits for the turn or joins it. Silently choosing for the user is how people
  conclude the agent ignored them.
* **The Command Center** (not "palette"): contributions are typed `action` or `choice`, ranked,
  keyword-searchable, and plugins can add rows.
* **Panes and tabs** with declared placements (`pane`, `prefer`, `focused`, `ambient`), and tabs that
  *reject* unsupported destinations rather than substituting a panel type.
* **The Explorer as a separate dock** that divides the whole workspace, with its own width and
  toggle — not a pane competing with the work.
* **Settings in two scopes**: app-global and per-host. Ours adds a third level, per project, because
  the project is where defaults belong (`docs/envoydev-ui.md`).
* **Keyboard shortcuts with user overrides, and a help dialog that shows *effective* bindings** — an
  unassigned shortcut must read as unassigned, not advertise a dead default.
* **Design laws** we adopt verbatim in spirit: hierarchy by weight and colour rather than size; one
  accent action per view; destructive colour only inside a confirmation; sentence case without
  trailing periods on labels; a compact-first list+detail shape.

## 4. What we deliberately do differently

Each of these is a place where Paseo's choice is defensible in its context and wrong in ours.

**1. Pairing is not authority.** Paseo's cross-machine route is a relay plus a pairing link, and the
link is an unauthenticated bearer capability — unsigned, no expiry, no single-use, no revocation
(`packages/protocol/src/connection-offer.ts`). Worse, the relay path admits sockets with
`OWNER_SESSION_ADMISSION` by default (`websocket-server.ts:966-975`, called without an admission at
`bootstrap.ts:1735`), while the direct path checks a password (`auth.ts`) — so raising exposure
silently raises authority. (A desktop-managed daemon binds loopback and is unauthenticated by
default, so this is not a default-install hole; the loopback bind is what keeps it safe.)

**Ours:** pairing transfers the *ability to ask*, not the authority to act. The phone presents a
token the daemon issued, scoped to a product, and the mesh node grants what a product may call. A
code that leaks is a code someone else can try to use and be refused. See
`docs/envoydev-networking.md` §4.

**2. Mobile credentials go in the platform's secure storage.** Paseo stores the daemon password in
plain AsyncStorage (`packages/app/src/runtime/host-runtime.ts:1319`), with no use of
expo-secure-store anywhere in the app. Our roadmap puts tokens in Keychain/Keystore and treats the
plain file as a development fallback with a warning — the token is the whole credential, so where it
sits is a security decision, not a storage detail.

**3. The renderer does not name transports.** Paseo's desktop validates a renderer-supplied
`transportPath` only as a non-empty string and then dials it as a Unix socket or Windows named pipe
(`packages/desktop/src/daemon/local-transport.ts:122-128`). In our shell, the window may ask for the
*daemon*, and the shell decides what that means — the window never supplies a path to dial.

**4. One root per home, and product state separated.** Paseo's daemon has one home per install
(`$PASEO_HOME`). We inherit the family's split — shared kernel state, per-product state — so several
products coexist without reading each other's data (`docs/envoydev-design.md` §6).

## 5. What we looked at and did not take

* **Electron.** Paseo's desktop is Electron 44, reusing its own binary as Node. EnvoyDev uses
  **Tauri v2**, because it is what the family ships and what its supervisor lessons are written
  against (`apps/tauri/src-tauri/src/main.rs` in EnvoyMesh: kill only your own pid, verify the
  health body's identity, resolve the shared home). The cost is real and accepted: three WebViews
  (WKWebView, WebView2, WebKitGTK) instead of one Chromium.
* **Their relay service.** It is an external Elixir deployment; the in-repo Cloudflare adapter is
  legacy. We use the mesh instead.
* **An Expo app for mobile.** EnvoyDev's phone app is Flutter, matching EnvoyGo, which is already
  in the family and whose pairing/refusal logic we mirror sentence for sentence.
* **`docs/permissions.md`'s principal/grant model.** It describes intent the code does not implement
  (no principal or credential types exist in the server). Worth reading for the direction of travel;
  not a description of shipped behaviour.

## 6. How to keep this honest

Two rules for future changes:

1. **A change here that copies a file from Paseo must say so in the commit** and carry the
   attribution Apache-2.0 requires. Adding the sentence "this is a reimplementation" to a copied
   file is not compliance.
2. **A claim about Paseo's behaviour in these docs must cite `file:line` in that repo.** Several of
   its own docs point at files that have moved (`docs/providers.md:283` names a manifest path that
   does not exist), which is exactly why we cite source rather than prose.
