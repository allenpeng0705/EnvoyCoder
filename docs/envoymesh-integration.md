# Living next to EnvoyMesh

**Rule of thumb:** EnvoyCoder *links* the mesh and *clones* the harness. It vendors neither.

---

## 1. What is linked, and from where

Eight `@envoymesh/*` packages arrive as `file:` links to a sibling checkout:

```
../EnvoyMesh/packages/{protocol, identity, vault, api, node-core, harness, host-connect, reuse-host}
```

Declared in `packages/host-bridge/package.json`. **All eight, not just the four we import**: EnvoyMesh's
packages depend on one another by *exact version* (`"@envoymesh/api": "0.5.0"`), not by a workspace
protocol, so npm satisfies those names from `node_modules` and the whole closure must be linked or the
install fails on a package nothing here mentions.

Two consequences worth knowing:

* **The sibling must be built.** We consume `dist/src/index.js` (their `rootDir` is the package), not
  their TypeScript sources. `npm run peers:check` resolves each package's real entry point from its own
  manifest and prints the exact `tsc -b` command when one is missing — the failure mode otherwise is
  `ERR_MODULE_NOT_FOUND` from four directories deep inside a `file:` path.
* **We do not alias their sources into our tests.** The family learned this the hard way: a test-time
  alias hid a *stale sibling copy* of `@envoymesh/protocol` for an entire refactor, so the suite was
  green while the real node could not start. Our tests resolve `@envoymesh/*` through `node_modules`
  exactly as production does, so a stale or missing sibling fails in CI rather than in a user's evening.

## 2. What must be cloned, never linked through EnvoyMesh

`@envoymesh/envoy-harness*` is a **peer** of every product in the family, not a package EnvoyMesh
distributes (EnvoyMesh design **D4**, guide §7.5). EnvoyCoder therefore clones or copies the harness
itself:

```bash
git clone <envoy-harness> ../envoy-harness        # or into ./vendor/envoy-harness
```

`npm run peers:check` reports its absence — as a **warning** while nothing depends on it, and as an
**error** the moment a manifest declares `@envoymesh/envoy-harness`. That switch is deliberate: a
prerequisite the tree does not use should not block unrelated work, and a prerequisite it *does* use
must not be a footnote.

Why the rule exists at all: if EnvoyCoder reached the harness *through* EnvoyMesh, it would depend on
that repo for someone else's package and inherit its release cadence for code it does not own. What
EnvoyMesh owes us instead is a failure that says what is missing and how to get it — which is what its
`check-peer-deps.mjs` does on its side and ours does on this one.

## 3. What we may touch, and what we may not

| | |
|---|---|
| **Shared home** | resolve it with `@envoymesh/node-core`'s `resolveHomeDir` + `profileDirIn`, so `ENVOYMESH_HOME`, the per-OS default and legacy `~/.envoymesh` adoption all behave identically in both apps |
| **Kernel state** (`profile/`) | **read only, and only through a granted session.** Identity, trust, node config and the vault index belong to the node |
| **Our state** | `<home>/EnvoyCoder/` — projects, workspaces, runs, transcripts, settings. Built in exactly one place (`coderPaths`) |
| **Product attach** | `attachLocalProduct` over loopback, pre-auth by design; we take the token and use only what the owner granted |

Another product must not be able to read which repositories you have opened, and we must not be able
to read anyone's chat transcripts. Both are enforced by path, not by convention.

## 4. When a contract change is needed

If EnvoyCoder needs a symbol that lives in EnvoyMesh's **product-bound** half, the answer is not a
fork or a copy. The family's procedure (guide §7.4):

1. move the *contract* symbol into a core package — `@envoymesh/protocol` for wire/CONTRACT types,
   `@envoymesh/node-core` for host concerns;
2. re-export it from where it was, so nothing breaks;
3. add a test asserting the whole family still shares one definition;
4. run the family's own gates (`check-module-boundary`, `classify-modules`, `generate-core-surface`)
   in the same change;
5. then update the `file:` link here.

Every product that joined before — EnvoyGo's RPC surface, EnvoyMesh's own harness extraction — travelled
that path, and each one left behind exactly that test.

## 5. Keeping the two repos in step

* **Version skew is the enemy.** A sibling four modules behind is a class of bug the family has already
  written down; `npm run peers:check` fails on a missing build, and the pins are `file:` links, so
  "which EnvoyMesh is this?" has one answer per checkout.
* **The pin is explicit.** `file:` means "the checkout next to me", so CI clones the sibling at the
  branch it needs (`.github/workflows/ci.yml`) rather than inheriting a developer's working copy.
* **No `pnpm install` at the EnvoyMesh root** from a script here; the family's own tooling manages that
  checkout.
* **Report the version you tested against.** When a change here depends on a family behaviour,
  `docs/` should name the commit or version — the same discipline the family applies to its own claims.

## 6. Gates in this repo

| Command | What it protects |
|---|---|
| `npm run peers:check` | the mesh closure resolves *and is built*; the harness is present (or honestly absent) |
| `node scripts/check-src-clean.mjs` | no build output inside a `src/` tree, and no build-info outside an output dir — a stale `src/index.js` shadows the real source in tests, and a misplaced `tsconfig.tsbuildinfo` makes `tsc -b` a silent no-op |
| `npx tsc -b` | project references, so a consumer that forgot its reference fails here |
| `npm test` | 61 tests over the model, the platform layer, the catalogue, the bridge and the rail |
| `npm run build -w @envoycoder/desktop` | the UI *bundles* — a green suite has never proved that |
| `npm run smoke` | a real host on a real port, a real pairing code, and a real probe of your installed agents |
| `npm run mobile:check` | the Flutter app still has the files a build needs |
