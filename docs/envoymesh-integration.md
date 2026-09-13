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

### 5.1 The documents we copy in, and why that is not vendoring

Code is *linked* from the sibling checkout; three **documents** are copied, because a developer here
should not need a second checkout open to read the rules they are held to. They live in
[`docs/family/`](family/), with an index in [`docs/family/README.md`](family/README.md):

| Copy | Why it is here |
|---|---|
| `envoymesh-new-app-guide.md` | the standard this repo is built to, and the checklist its gates implement |
| `envoymesh-multi-product-design.md` | the rules it must not break (D2 one node owner, D3 share the engine never the cloud, D4 the harness is a peer) |
| `envoymesh-refactoring-plan.md` | background: the reusable / product-bound split *is* the interface we consume |

A copy is only safe if it cannot quietly become wrong, so each one carries a provenance header — source,
commit, date, and the SHA-256 of the body as copied — and `npm run docs:check` reads it. That check is
deliberately **asymmetric**:

* **Edited in place → fail.** The body no longer matches its own header. Somebody is editing a mirror,
  and the next sync would destroy the change.
* **Source moved → note, exit 0.** A document being edited in EnvoyMesh is no reason for this repo's
  build to stop — cross-repo coupling is exactly what the family design refuses (D1). `--strict` is the
  pre-release form, where a stale copy *is* an error.

`npm run docs:sync` is the only way a copy changes. It records `+ uncommitted changes` when EnvoyMesh's
own tree is dirty, so a copy never claims a commit it did not come from. This is the same rule as §2 —
we clone what we need and we do not pretend to own it — applied to prose.

## 6. Gates in this repo

| Command | What it protects |
|---|---|
| `npm run peers:check` | the mesh closure resolves *and is built*; the harness is present (or honestly absent) |
| `npm run wiring:check` | every package declared in every place that resolves it (guide §4.1) — the failure mode with no clear error |
| `npm run docs:check` | the copies in `docs/family/` are still the documents they claim to be (§5.1) |
| `node scripts/check-src-clean.mjs` | no build output inside a `src/` tree, and no build-info outside an output dir — a stale `src/index.js` shadows the real source in tests, and a misplaced `tsconfig.tsbuildinfo` makes `tsc -b` a silent no-op |
| `npx tsc -b` | project references, so a consumer that forgot its reference fails here |
| `npm test` | 67 tests over the model, the platform layer, the catalogue, the bridge and the rail |
| `npm run build -w @envoycoder/desktop` | the UI *bundles* — a green suite has never proved that |
| `npm run smoke` | a real host on a real port, a real pairing code, and a real probe of your installed agents |
| `npm run mobile:check` | the Flutter app still has the files a build needs |

---

## 7. Audit against the family guide (`envoymesh-new-app-guide.md`)

The guide is the standard for a new app in this group — read it at
[`docs/family/envoymesh-new-app-guide.md`](family/envoymesh-new-app-guide.md), or in EnvoyMesh itself,
which is authoritative (§5.1). This is the state of each of its requirements, with the honest gaps at
the bottom.

### 7.1 The seven wiring places (§4.1)

| Guide rule | Applies? | State |
|---|---|---|
| 1. root `package.json` → `workspaces` | yes | ✓ all six packages covered |
| 2. the package's own manifest | yes | ✓ `main`/`exports` on libraries; apps exempt (nothing imports them) |
| 3. **each consumer's** `dependencies` | yes | ✓ |
| 4. **each consumer's** `tsconfig` `references` | yes | ✓ — **this was missing** for `apps/desktop` until the gate below found it |
| 5. root `tsconfig` `references` | yes | ✓ |
| 5b. `tsconfig.base.json` → `paths` | **no, deliberately** | mapping a package name to another package's *source* cannot coexist with `composite`/`rootDir`: TypeScript answers `TS6059`/`TS6307`, the confusing failure the guide warns about. We resolve via npm workspace links + project references, and keep source resolution where it belongs — the vitest aliases |
| 6. `vitest.config.ts` → alias | yes | ✓ all libraries |
| 7. `pnpm-workspace.yaml` → `packages` | **not used** | no pnpm consumer in this repo; the gate prints that rather than skipping silently |

`npm run wiring:check` implements the applicable rules (R1–R4, R6, R7) and is wired into
`typecheck`, `gates` and CI. It was proven by seeding a violation (dropping a real
`references` entry) and observing the failure — a gate that has never failed is a gate nobody has
tested.

### 7.2 Depend on the surface (§4.2, §4.3)

* `@envoymesh/reuse-host` supplies the host and the attach client; `@envoymesh/node-core` the home and
  discovery; `@envoymesh/protocol` the pairing contract.
* **`@envoymesh/api/core`, never the bare barrel** — and the wiring gate fails on the bare import,
  because the barrel reaches product-bound modules.

### 7.3 The shared home (§4.4)

`coderPaths()` resolves the home with the family's `resolveHomeDir()` and the product segment with
`productDirIn()`. The first version called `os.homedir()`, which would have ignored `ENVOYMESH_HOME`
and the per-OS default — giving a user who set the variable a second home and a second set of
projects. A test asserts the variable is honoured.

### 7.4 Attach instead of competing (§4.5)

`resolveRunningNode` → verified node → `requestProductSession` with `product: "EnvoyCoder"` and
`version: ENVOYMESH_VERSION`; the endpoint comes from the node's descriptor, with its URL as a
fallback. An **owner-scoped** token is refused rather than used, and a refusal is a normal outcome.

**Verified against a real node** (guide §8): with an EnvoyMesh node running on this machine, the
smoke test attaches over loopback and reports `product:EnvoyCoder at ws://127.0.0.1:4180/ws?token=…`.

### 7.5 The dispatcher (§4.6) and the family's security claim (§8)

`createCoderDispatcher` answers its own methods and refuses everything else, including
known-but-unimplemented ones. It never mints credentials: issuing a token is the node's act.

The transport's gates are the family's, and they are per **method**, not per connection — a socket
from the LAN opens by design, and the refusal is the answer to the call:

```
✓ refuses a tokenless call from the LAN, while loopback is trusted
      LAN (192.168.3.85) → UNAUTHORIZED; loopback → answered
```

The smoke test asserts the *answer* rather than the socket closing, because "the connection closed"
would pass for the wrong reason — that was the first finding, and it was about the test.

Writing the leg then found a real bug here, invisible to `tsc` until the port type was annotated: our
dispatcher took an object where the family's port is positional (`method, params, session`), so the
host called it with a string and it silently answered nothing — a `tsc`-clean daemon that answers no
call at all. The return type is annotated now, so the next divergence is a compile error rather than
a silence.

### 7.6 Capabilities are granted (§4.7)

`CAPABILITY_CODING` names what this product exists to use, and the docs say what the guide says: until
the owner runs `updateNodeConfig({ productGrants: { EnvoyCoder: ["coding"] } })`, the node refuses it,
the read fails closed, and "not granted" is a state to report rather than retry.

### 7.7 Pairing (§5.2, §5.3)

The phone uses the family's **shared Dart contract** (`envoy_thin_client`) via a path dependency to
the sibling checkout: one parser, one refusal sentence, one place where the format changes. It was
re-implemented locally at first — the same duplication the guide's §5.2 exists to prevent.

**This found a gap upstream.** `PairingPayload.relayWsUrls` existed in the contract
(`protocol/src/pairing-contract.ts`) and in the compact token codec (`pairing-token.ts`), but the
`envoy://pair` URI could neither build nor parse it — so no QR code could offer a relay fallback.
Per guide §7.4 the fix went **upstream**, not into this repo: `api/src/envoy-pair-uri.ts` now carries
the list (comma-joined, read back by a `list()` helper) with round-trip tests. EnvoyMesh's gates and
its `api`/`reuse-host`/`protocol` suites pass with the change.

### 7.8 What is not done

| Guide item | State |
|---|---|
| §8 "your stores grouped, 0 ungated" | N/A yet: the daemon does not persist stores; the analogue here is `coderPaths()` returning paths under `<home>/EnvoyCoder/` |
| §8 four EnvoyMesh-repo gates (classify/boundary/inventory/core-surface) | those check *EnvoyMesh's* tree; this repo's analogues are `wiring:check`, `check-src-clean`, `peers:check` |
| §4.6 "your product scope is refused by default" | our daemon does not yet consult `productGrants` — it does not call the mesh at all beyond attaching |
| §8 "no new anonymous path … no shared key" | holds today (loopback-or-session is the transport's, and we add no path), but it is asserted by the smoke, not by a unit test |
| §9 "biggest open question: what a product may call" | open by design; `docs/envoycoder-design.md` §7 lists it among the undecided |
