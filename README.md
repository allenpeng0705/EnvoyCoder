# EnvoyDev

**The control plane for coding agents.** Run agents in parallel across your own machines — your
desk, your workstation, your server — and reach them from a window or a phone.

EnvoyDev is a member of the **EnvoyMesh apps group**: it shares the mesh (identity, discovery,
relay) and the pairing experience with the rest of the family, and keeps its own state to itself.

---

## What it is

| | |
|---|---|
| **A control plane, not another agent** | It drives agents — yours (`envoy-harness`), DeepSeek's (`dsh`), and the CLIs the world already uses (`claude`, `codex`, `copilot`, `opencode`, `cursor-agent`, `pi`). It does not try to be one. |
| **Projects are places, tasks are units of work** | A project is a directory you work in; a task is one unit of work in it, with its own branch, agent and model. The left rail is that tree, because "which repo is this in?" is the question a control plane must answer without a click. |
| **Local first, distributed when you want it** | Agents run on the machine where the code is. With the mesh attached, a task can run on another of your machines — the same relationship EnvoyMesh has with its peers. |
| **Your credentials stay yours** | Model keys live with the agent that uses them. EnvoyDev never proxies your provider credentials, and it never asks for an account. |
| **macOS, Windows and Linux** | All three are first-class: the platform layer is a package with the differences written down and tested, not `if (win32)` scattered through the code. |

## Quickstart

```bash
npm install
npm run peers:check   # confirms the EnvoyMesh sibling + harness are where they should be
npm run wiring:check  # every package declared everywhere that resolves it (guide §4.1)
npm run gates         # peers + wiring + family docs + src-clean + mobile + typecheck + tests
npm run dev           # the desktop UI in a browser (Vite)
npm run tauri:dev     # the desktop app (Tauri shell)
npm run smoke         # boots a real host, mints a real pairing code, probes your agents
```

The mobile app is Flutter:

```bash
cd apps/mobile && flutter pub get && flutter test
```

## What is in this scaffold

```
apps/desktop/        Tauri shell + the window UI (project rail, task pane, composer)
apps/mobile/         Flutter app: pair with a desktop, check on running work
packages/protocol/   EnvoyDev's own wire contract (projects, tasks, run events, errors)
packages/platform/   everything that differs per OS: PATH, shells, quoting, process trees, ssh
packages/task-model/       the project → task model and the sidebar's queries
packages/agent-catalog/    which agents we drive, how, and what each one can actually do
packages/host-bridge/      the EnvoyMesh attach + this product's own daemon host
docs/                the design, and the reasoning behind it
docs/family/         copies of the EnvoyMesh documents that govern this product
```

## Read this before changing anything

1. `docs/family/envoymesh-new-app-guide.md` — the family's standard for an app, and the checklist this
   repo's gates implement. **A copy**: read it here, fix it in EnvoyMesh, refresh with `docs:sync`.
2. `docs/envoydev-design.md` — what the product is and the decisions already taken.
3. `docs/envoydev-networking.md` — how it joins the EnvoyMesh family (and what it may not do).
4. `docs/envoydev-platforms.md` — the three operating systems and their traps.
5. `docs/envoymesh-integration.md` — how this repo relates to EnvoyMesh: what it links, what it
   must clone, and how contract changes travel upstream.
6. `docs/upgrading.md` — how to move the linked EnvoyMesh packages and the harness forward, and how to
   tell whether it worked.

## Status

**M1, M2 and M3 landed: the desktop app runs agents and answers them.** The daemon serves the project, task, settings
and *run* methods over the family's WebSocket host and persists them to `<home>/EnvoyDev/`; the
Tauri shell starts and supervises the daemon; the window renders the daemon's state and a live
transcript rather than fixtures; and a task started in the window drives a real agent process over the
Agent Client Protocol, with normalized events, an inline approval card, cancel, queue/steer and resume.
A corrupt state file is quarantined, never overwritten; two agents are never started in one working
tree.

Escalations are answered inline: an approval renders as a card in the transcript, with the agent's own
option labels, and the run continues once it is answered. The composer's Queue and Steer are genuinely
different — Queue waits for the turn, Steer interrupts it — and the transcript records which happened.

What is not real yet: the **diff panel** (a `run.diff` renders as "3 files changed" and nothing
opens), approvals answered from the **phone** (M4), and a **successful model turn** on this machine —
`dsh` is installed and driven, but the box has no DeepSeek credential, so the run ends with the agent's
own sentence about the missing key. That path is tested; the successful one needs
`RUN_LIVE_ACP=1`.

```bash
npm run daemon:build   # bundle the daemon the shell spawns
npm run tauri:dev      # the desktop app, daemon included
npm run run -- --prompt "add a test for the parser"   # one task, over the wire, from a terminal
npm run smoke          # boots the bundled daemon as a child process and speaks to it
```

`docs/roadmap.md` lists what each milestone has to prove, and marks where M1's and M2's evidence is.
