# EnvoyCoder

**The control plane for coding agents.** Run agents in parallel across your own machines — your
desk, your workstation, your server — and reach them from a window or a phone.

EnvoyCoder is a member of the **EnvoyMesh apps group**: it shares the mesh (identity, discovery,
relay) and the pairing experience with the rest of the family, and keeps its own state to itself.

---

## What it is

| | |
|---|---|
| **A control plane, not another agent** | It drives agents — yours (`envoy-harness`), DeepSeek's (`dsh`), and the CLIs the world already uses (`claude`, `codex`, `copilot`, `opencode`, `cursor-agent`, `pi`). It does not try to be one. |
| **Projects are places, workspaces are tasks** | A project is a directory you work in; a workspace is one task in it, with its own branch, agent and model. The left rail is that tree, because "which repo is this in?" is the question a control plane must answer without a click. |
| **Local first, distributed when you want it** | Agents run on the machine where the code is. With the mesh attached, a task can run on another of your machines — the same relationship EnvoyMesh has with its peers. |
| **Your credentials stay yours** | Model keys live with the agent that uses them. EnvoyCoder never proxies your provider credentials, and it never asks for an account. |
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
apps/desktop/        Tauri shell + the window UI (project rail, workspace pane, composer)
apps/mobile/         Flutter app: pair with a desktop, check on running work
packages/protocol/   EnvoyCoder's own wire contract (projects, workspaces, run events, errors)
packages/platform/   everything that differs per OS: PATH, shells, quoting, process trees, ssh
packages/workspace-model/  the project → workspace model and the sidebar's queries
packages/agent-catalog/    which agents we drive, how, and what each one can actually do
packages/host-bridge/      the EnvoyMesh attach + this product's own daemon host
docs/                the design, and the reasoning behind it
docs/family/         copies of the EnvoyMesh documents that govern this product
```

## Read this before changing anything

1. `docs/family/envoymesh-new-app-guide.md` — the family's standard for an app, and the checklist this
   repo's gates implement. **A copy**: read it here, fix it in EnvoyMesh, refresh with `docs:sync`.
2. `docs/envoycoder-design.md` — what the product is and the decisions already taken.
3. `docs/envoycoder-networking.md` — how it joins the EnvoyMesh family (and what it may not do).
4. `docs/envoycoder-platforms.md` — the three operating systems and their traps.
5. `docs/envoymesh-integration.md` — how this repo relates to EnvoyMesh: what it links, what it
   must clone, and how contract changes travel upstream.
6. `docs/upgrading.md` — how to move the linked EnvoyMesh packages and the harness forward, and how to
   tell whether it worked.

## Status

Scaffold. The UI runs on fixtures; the daemon is specified and hosted but does not yet serve the
catalogue in `@envoycoder/protocol`. `docs/roadmap.md` lists what each milestone has to prove.
