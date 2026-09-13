# EnvoyCoder — working notes for agents and contributors

## What this repo is

The control plane for coding agents (`README.md`), a member of the **EnvoyMesh apps group**. It
shares the mesh and pairing with the family and keeps its own state separate.

## Non-negotiables

1. **The family's rules are not suggestions.** The shared home is resolved by EnvoyMesh's
   `node-core`; product state lives in `<home>/EnvoyCoder/`; the harness is a *peer* we clone, never
   something we take through EnvoyMesh's link (`docs/envoymesh-integration.md`).
2. **No `process.platform` checks in feature code.** Platform differences go in
   `@envoycoder/platform`, parameterised so their branches are tested on whichever OS runs the suite.
3. **A claim in `docs/` needs a source.** Cite `file:line` for anything said about Paseo or DeepSeek
   Harness; those docs drift, and one of Paseo's points at a file that does not exist.
4. **Never claim a capability the protocol does not provide.** An agent's `capabilities` says what the
   surface can do — cancel, approvals, structured tools — and the UI's promises follow from it.
5. **User-facing strings are end-user language.** Headline first, detail second, developer fields last.
   The audit log and tooltips are where internal names belong.
6. **Tests and the bundle are different proofs.** Run `npx vitest run` *and*
   `npm run build -w @envoycoder/desktop`; a green suite once shipped a broken import path.
7. **A family document is copied, never edited.** `docs/family/` holds the EnvoyMesh documents that
   govern this product, with their provenance in their header. Rewording one changes only the copy: the
   fix belongs in EnvoyMesh, and comes back with `npm run docs:sync` (guide §7.4).

## Layout

```
apps/desktop/     Tauri shell (Rust) + window UI (React) + the daemon (TS)
apps/mobile/      Flutter app
packages/{protocol,platform,workspace-model,agent-catalog,host-bridge}
scripts/          the gates (peers, wiring, family docs, src-clean, mobile) and the smoke test
docs/             the design and its reasoning
docs/family/      copies of the EnvoyMesh documents that govern us — read, never edited
```

## Commands

```bash
npm run peers:check    # mesh closure + harness
npm run wiring:check   # every package declared everywhere that resolves it
npm run docs:check     # the family copies still match what they were copied from
npm run docs:sync      # refresh docs/family/ from ../EnvoyMesh
npm run upgrade:mesh   # upgrade the linked EnvoyMesh packages (see docs/upgrading.md)
npx tsc -b             # typecheck every project
npm test               # unit tests
npm run smoke          # real host, real pairing, real agent probes
npm run dev            # UI in a browser
npm run tauri:dev      # the desktop app
npm run gates          # peers + wiring + family docs + src-clean + mobile + typecheck + tests
```

## Upgrading what we depend on

Full procedure, with the failures and their fixes: **`docs/upgrading.md`**.

| Dependency | Upgrade |
|---|---|
| the mesh layer (8 linked packages) | `npm run upgrade:mesh -- --verify` — or by hand: pull the sibling, `npm install` there, `npx tsc -b` the 8 packages, then `npm install && npm run gates && npm run smoke` here. **The rebuild is the upgrade**: `node_modules` is a symlink, so sources change the moment you pull, while the code we import is their `dist/`. |
| the harness (our clone, D4) | bump the pin (a commit — all ten of its packages are `0.0.0`), `pnpm install && pnpm -r run build` in `../envoy-harness`, then `gates` + `smoke`. Never through EnvoyMesh's link, and never vendored inside this repo: its own workspace overrides point at `../EnvoyMesh/packages/*`. |
| the external agent CLIs | nothing to do — they are the user's installs, and we probe them at runtime. |

Before a release: `npm run upgrade:mesh -- --commit <sha> --verify`, `npm run docs:check -- --strict`, and
record the EnvoyMesh and harness commits in the release notes.

## Conventions

* TypeScript, ESM, `NodeNext`; `.js` extensions on relative imports; no semicolons; 2-space indent.
* Packages: `src/index.ts` is the public surface; tests in `test/`.
* Keep a module under ~500 lines; past ~800, split it (the family's rule, and it has teeth).
* Comment the *why*: a comment that repeats the code is noise, a comment that records the alternative
  you rejected is the most valuable line in the file.
* New to the family? Read `docs/envoycoder-design.md` §4 (the decisions) before changing anything
  structural.
