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
npx tsc -b             # typecheck every project
npm test               # unit tests
npm run smoke          # real host, real pairing, real agent probes
npm run dev            # UI in a browser
npm run tauri:dev      # the desktop app
npm run gates          # peers + wiring + family docs + src-clean + mobile + typecheck + tests
```

## Upgrading what we depend on

| Dependency | Upgrade |
|---|---|
| the mesh layer (8 linked packages) | `cd ../EnvoyMesh && git pull && npm install` then `npx tsc -b packages/{protocol,identity,vault,api,node-core,harness,host-connect,reuse-host}` — **the rebuild is the upgrade**: `node_modules` is a symlink, so the sources change the moment you pull, while the code we import is their `dist/`. `peers:check` warns when sources are newer than the build. Then `npm install && npm run gates && npm run smoke`. |
| the harness (our clone, D4) | bump our pin, rebuild it with its own `pnpm --filter … run build`, then `gates` + `smoke`. Never through EnvoyMesh's link. |
| the external agent CLIs | nothing to do: they are the user's own installs, and we probe them at runtime. |

`docs/envoymesh-integration.md` §5.2 has the reasoning, what breaks in which order, and the release
rule (an artifact records the EnvoyMesh and harness commits it was built against).

## Conventions

* TypeScript, ESM, `NodeNext`; `.js` extensions on relative imports; no semicolons; 2-space indent.
* Packages: `src/index.ts` is the public surface; tests in `test/`.
* Keep a module under ~500 lines; past ~800, split it (the family's rule, and it has teeth).
* Comment the *why*: a comment that repeats the code is noise, a comment that records the alternative
  you rejected is the most valuable line in the file.
* New to the family? Read `docs/envoycoder-design.md` §4 (the decisions) before changing anything
  structural.
