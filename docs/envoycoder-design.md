# EnvoyCoder — product design

**Status:** scaffold · **Owner:** product · **Created:** 2026-09-13

> **Why this document exists.** The code in this repo is small enough to read; the *decisions* are
> not visible in it. This is where they live, with the reasoning and the alternatives that were
> rejected — so the next person can disagree with a decision instead of rediscovering it.

---

## 1. The product

EnvoyCoder is a **control plane for coding agents**. You give it directories you work in; it runs
agents in them, in parallel, on whichever of your machines makes sense; and it tells you — in a
window, in a tray, on a phone — which ones need you.

It is *not* an agent. It is the thing that starts them, watches them, shows what they did, and asks
you the questions they raise. EnvoyCoder's own built-in agent (`envoy-harness`) exists because a
control plane needs one it fully understands, not because writing agents is the point.

## 2. What it inherits, and from where

The owner's instruction was explicit, and it splits cleanly in two:

| Source | What we take | What we do not |
|---|---|---|
| **Paseo** (Apache-2.0, `../paseo`) | the *ideas and the UX*: daemon-plus-clients architecture, provider abstraction, normalized streaming, the composer with Queue/Steer, the Command Center, panes and tabs, the attention model | its code (`docs/envoycoder-paseo-inheritance.md` explains the licensing position), and three of its weaknesses: a pairing link that *is* the authority, mobile credentials in plain storage, and a renderer that may name any transport for the shell to dial |
| **EnvoyMesh** (`../EnvoyMesh`) | the *network and identity*: the mesh, discovery, relay, pairing contract, product sessions, the shared home | its product surface — no chat, no bonds UI, no social state. EnvoyCoder reads **kernel** state only, and only what the node grants it |
| **DeepSeek Harness** (`../deepseek-harness`, MIT) | a first-class agent, driven over ACP | we do not link it: it is explicitly not a library, so we spawn it (`docs/envoycoder-harness.md`) |

## 3. The left rail, and why it is not Paseo's

Paseo's sidebar is a list of what they call *workspaces* grouped by project (their word; ours is a **task**). EnvoyMesh's Coding tab is a **tree**:
a project is a row you can collapse and configure, and it names the agent its children inherit.

The owner's instruction was to follow EnvoyMesh here, and the reason holds up:

* **"Is this repo busy?"** is answered by a per-project rollup (status counts, default agent)
  instead of by scrolling its tasks;
* **"new work in this repo"** is a control on the repo, not a global button plus a project picker;
* **settings live where the defaults live** — per project — with app-wide defaults at the foot of
  the rail.

Nothing else of the shell is EnvoyMesh's: the panes, tabs, Command Center, composer and attention
model are Paseo's, because that is the baseline users arrive with. `docs/envoycoder-ui.md` specifies
the whole surface.

## 4. Decisions

Each of these is settled; the alternative is recorded so it can be revisited deliberately.

**D1 — EnvoyCoder is its own app, its own process, its own release.** Not a tab inside EnvoyMesh.
A user who installs only EnvoyCoder must never load the social surface, and each product needs its
own crash, upgrade and permission domain.

**D2 — Agents run where the code is; the mesh carries the control plane.** A task on the workstation
runs on the workstation. What travels is prompts, events, approvals and diffs — not a repository
copy, and not the agent's process. This is the same rule EnvoyMesh applies to its own peers, and it
is why a laptop on a train can drive a build on a machine with the GPU.

**D3 — We join the family's network; we do not build a second one.** The mesh, the relay, the
pairing contract and the identity are EnvoyMesh's, shared with every product. EnvoyCoder contributes
its own *daemon* for its own clients, and attaches to the node as a **product** with a scoped
session. `docs/envoycoder-networking.md` has the details and the security reasoning.

**D4 — Multi-window is a mode, not an accident.** One daemon serves every window, and the same
daemon serves the phone. A second window attaches to the first daemon rather than starting a
competing one — the same "one owner at a time" rule the family applies to the node, for the same
reason (two processes with one identity is corruption, not sharing).

**State of this decision, honestly:** the *daemon* half is built and tested (many connections, many
subscribers, each window its own `CoderConnection`), and a second **app instance** attaches to the
running daemon. What the shell cannot do yet is **create** a second window: `tauri.conf.json` declares
one, `capabilities/default.json` scopes its permissions to `windows: ["main"]`, and no window-creating
command exists. Until that lands, the `{n} windows` chip counts *connections*, not windows — which is
why it is labelled by connection count and not called a window count.

**D5 — The agent catalogue is explicit, and tiered.** Native (`envoy-harness`, `deepseek-harness`)
versus external CLIs. The tier decides what the UI may promise: an agent we cannot cancel and cannot
ask on gets a terminal, not a diff panel and an approval dialog. Every entry carries its evidence.

**D6 — ACP is the common denominator.** Both native harnesses and several external agents speak the
Agent Client Protocol, which is what lets one adapter cover them. Agents with no ACP support get a
bespoke argv adapter, and are marked as such.

**D7 — Three platforms, one platform layer.** No `process.platform` checks scattered through
feature code; the differences live in `@envoycoder/platform`, parameterised so the Windows branch is
tested on macOS. `docs/envoycoder-platforms.md` lists what actually differs.

**D8 — No account, no telemetry, no proxy.** EnvoyCoder has no server. It never routes your model
traffic through anything of ours, and never asks for provider credentials for itself.

## 5. Shape of the system

```
        ┌── window 1 (Tauri) ──────┐   ┌─ window 2 ───┐   ┌── phone ──┐
        │   (Tauri webview)        │   │              │   │ (Flutter) │
        └───────────┬──────────────┘   └──────┬───────┘   └─────┬─────┘
                    │  EnvoyCoder protocol (WS JSON-RPC)        │  pairing code,
                    └───────────────┬───────────────────────────┘  host:port or SSH
                                    ▼
                        ┌───────────────────────┐
                        │   EnvoyCoder daemon   │   state: <home>/EnvoyCoder/
                        │  projects, tasks     │
                        │  agents, transcripts  │
                        └───────┬───────────────┘
                                │  product session (scoped, granted)
                                ▼
                        ┌───────────────────────┐
                        │  EnvoyMesh node       │   identity, discovery, relay
                        │  (one owner at a time)│   ── to your other machines ──▶ peers
                        └───────────────────────┘
```

Agents are children of the daemon — **spawned, not in-process**, including `envoy-harness`, whose
argv is `run --acp` and which we speak to over stdio like any other agent. (An earlier draft of this
document said "or in-process for `envoy-harness`"; the catalogue has never done that, and the uniform
transport is the reason one adapter serves both first-party harnesses.) Their lifetime is the daemon's:
closing a window does not kill a running task, which is the entire point of a control plane you can
walk away from.

## 6. State on disk

The family's layout, unchanged: a shared home holds **kernel** state every product reads (identity,
trust, node config), and each product keeps its own state in `<home>/<product>/`.

```
<home>/                     shared (EnvoyMesh's rule, §5 of its design)
  profile/                  identity, trust, node config, vault index — NOT ours to write
  EnvoyMesh/                the social product's state
  EnvoyCoder/               ours: projects, tasks, runs, transcripts, settings
    projects.json
    tasks.json
    runs/                   one record per run
    transcripts/            event logs, ours to keep or prune
    settings.json
```

Two consequences worth stating: another product cannot read which repositories you have opened, and
EnvoyCoder cannot read anyone's chat transcripts. That separation is enforced by path, and it is why
`coderPaths()` is the only place that builds these paths.

## 7. What this document does not decide

Open, and deliberately so:

* **how a distributed run is brokered** — peer-to-peer between daemons, or through the node as a
  relay for control messages (D2 fixes *where* the work runs, not who negotiates it);
* **the transcript format** — we own ours, but whether it is a projection of the harness's own log or
  a copy is unsettled;
* **whether windows may attach to a remote daemon** — the desktop today would spawn a local daemon;
  attaching to a peer's is the interesting case and needs the same ownership rules as the node;
* **pricing/licensing of this repo** — inherited from the family's practice, not yet written down.
