# Upgrading what EnvoyCoder depends on

EnvoyCoder runs on code it does not own: the family's mesh packages (linked), and the Envoy Harness (our
own clone). This is the procedure for moving either one forward, and for knowing whether it worked. It is
written to be followed literally — every command here was run, and every failure in §5 was hit at least
once while this repo was built.

**The one rule that makes the rest make sense:** *we import EnvoyMesh's **built** output, not its
TypeScript.* So an upgrade is always two acts — **change the code** (pull, or check out a commit) and
**rebuild it** — and skipping the second one is the failure this repo has a gate for. `node_modules`
links are symlinks (`docs/envoymesh-integration.md` §1), so a pull changes what we *resolve* instantly
while the code we *run* stays at yesterday's build: nothing is missing, every test passes, and the only
thing wrong is that we are not testing what we think we are.

---

## 1. The four dependencies, and which of them can be upgraded

| Dependency | How it arrives | Upgrade it? |
|---|---|---|
| The mesh layer — 8 `@envoymesh/*` packages | linked from `../EnvoyMesh` | **yes**, §2 — it upgrades itself whether you like it or not, so the work is doing it deliberately |
| The Envoy Harness — `envoy-harness*` | our own clone, pinned | **yes**, §3 — at our pace, as a reviewable change |
| External agent CLIs — `dsh`, `claude`, `codex`, `copilot`, `opencode`, `cursor-agent`, `pi` | spawned and probed | **no**, §4 — the user's installs; we re-probe and report |
| The family documents | copied, with provenance | `npm run docs:sync`, §6 |

---

## 2. Upgrading the mesh layer

### 2.1 The short path

```bash
npm run upgrade:mesh -- --verify
```

That is `scripts/upgrade-mesh.mjs`, which runs §2.2 in order, prints every command before running it, and
stops at the first failure. `--dry-run` prints the plan without executing anything; `--commit <sha>` pins
to an exact commit instead of following the branch; `--allow-dirty` is how you say "the uncommitted work
in that tree is mine"; `--skip-install` rebuilds only.

### 2.2 The manual path — what the script does, and why each step exists

Run these from `EnvoyCoder/`. `MESH=../EnvoyMesh` for brevity.

**Step 0 — know where you are, and whether the tree is clean.**

```bash
git -C "$MESH" rev-parse --short HEAD            # write this down: it is your rollback point
git -C "$MESH" status --porcelain                # must be empty
```

A dirty sibling is a **stop**, not a warning. Because the packages are symlinked, this repo is already
running that working tree, so pulling on top of someone's unfinished work either loses it or half-merges
it into a state neither of you chose. Commit or stash it there first. (The script refuses on this; when it
does, that is the guard working.)

**Step 1 — change the code.**

```bash
git -C "$MESH" pull --ff-only                    # or: git -C "$MESH" fetch && git -C "$MESH" checkout <sha>
```

`--ff-only` on purpose: a merge commit inside a dependency checkout is a state nobody can reproduce from
a branch name. When reproducing a release, use `--commit <sha>` instead.

**Step 2 — install the sibling's dependencies.**

```bash
(cd "$MESH" && npm install)
```

EnvoyMesh's packages depend on one another by **exact version** (`"@envoymesh/api": "0.5.0"`), so a
release that renames or adds a package needs its install re-run or the closure resolves to the wrong
thing. Do **not** run `pnpm install` at that root — the family manages that checkout with npm.

**Step 3 — rebuild the packages we link.** This is the step people skip.

```bash
(cd "$MESH" && npx tsc -b packages/protocol packages/identity packages/vault \
    packages/api packages/node-core packages/harness packages/host-connect packages/reuse-host)
```

One invocation, all eight: project references make `tsc -b` resolve the order, and eight separate builds
would rebuild shared dependencies eight times. **All eight, not only the four we import** — the closure
matters, because their packages import each other.

**Step 4 — re-resolve here.**

```bash
npm install
```

For a version bump this refreshes `package-lock.json`; for a same-version change it is a no-op. Cheap,
and it is what makes "which EnvoyMesh is this?" answerable per checkout.

**Step 5 — prove it here.** Types are not behaviour:

```bash
npm run gates      # peers (which now names the commit), wiring, family docs, src-clean, mobile, tsc, 67 tests
npm run smoke      # a real host, a real node attach over loopback, a real tokenless LAN refusal
```

### 2.3 How you know it worked

* `npm run peers:check` prints the new commit and subject, and **no** "packages are out of date" warning.
  If that warning is still there, step 3 did not run, or ran against a different checkout.
* `npm run gates` exits 0.
* `npm run smoke` reports 6/6 — including the attach leg, which talks to a **real running node** if one is
  up, and says honestly which node it could not find if none is.

### 2.4 Rolling back

```bash
git -C "$MESH" checkout <the sha you wrote down in step 0>
(cd "$MESH" && npx tsc -b packages/protocol packages/identity packages/vault packages/api \
    packages/node-core packages/harness packages/host-connect packages/reuse-host)
cd ../EnvoyCoder && npm install && npm run gates
```

Rolling back is the same procedure with one step changed, deliberately: a rollback that forgets to rebuild
leaves you on the new build with the old sources — the same trap in the other direction.

### 2.5 Pinning for a release

While we are pre-1.0 and co-developing, following the sibling's branch is what we want: it surfaces
breakage instead of freezing it. **A release is different**, and it uses the pin:

```bash
node scripts/upgrade-mesh.mjs --commit <sha>     # fetch, check out exactly this, rebuild, verify
```

Then record that commit (and the harness commit from §3) in the release notes. An artifact that cannot
name the family commit it was built against cannot be debugged or reproduced six months later. The
stronger option — vendoring the five core packages at a commit, offline and airtight — is the guide's
first choice (§7.2) and the right one only when we need reproducible builds without a sibling checkout;
today it would mean holding a copy that goes stale silently, which is the family's own documented
incident (`docs/envoymesh-integration.md` §5.2).

### 2.6 If EnvoyCoder needs a change in their code

Never patch it here — not in `node_modules`, not in a vendored copy. A change we need goes **upstream
first** (guide §7.4), and comes back to us as an upgrade. That is how the pairing URI gained
`relayWsUrls`: it was missing for a QR relay fallback, the fix landed in `EnvoyMesh/packages/api` with
round-trip tests, and EnvoyCoder picked it up by upgrading. Upstream's own gates:

```bash
cd "$MESH"
node scripts/classify-modules.mjs          # regenerate the manifest in the same change
node scripts/check-module-boundary.mjs
node scripts/generate-core-surface.mjs     # if the RPC surface changed
npx tsc -b && npx vitest run
```

---

## 3. Upgrading the Envoy Harness

### 3.1 Where it lives, and why not inside this repo

The harness is a **peer** (design D4): each product clones or copies it, and EnvoyMesh never distributes
it. We use a sibling checkout next to EnvoyMesh:

```
mygithub/
├── EnvoyMesh/
├── envoy-harness/     ← the harness, our clone
└── EnvoyCoder/
```

**It must sit next to EnvoyMesh, not inside EnvoyCoder.** Its `pnpm-workspace.yaml` redirects its own
internal family dependencies with paths relative to its parent:

```yaml
overrides:
  "@envoymesh/protocol": "link:../EnvoyMesh/packages/protocol"
  "@envoymesh/identity": "link:../EnvoyMesh/packages/identity"
  "@envoymesh/agent-adapter": "link:../EnvoyMesh/packages/agent-adapter"
```

Cloning it to `EnvoyCoder/vendor/envoy-harness` would make those paths resolve to
`EnvoyCoder/vendor/EnvoyMesh/…`, which does not exist, and its build would fail — or worse, resolve a
different copy. (This is verified against the checkout, not inferred.) So: sibling of EnvoyMesh, and if
you ever need it elsewhere, expect to override that workspace config rather than editing it.

### 3.2 Getting and building it

```bash
git clone <envoy-harness> ../envoy-harness
cd ../envoy-harness
pnpm install            # pnpm 10+: it blocks postinstall scripts except `onlyBuiltDependencies`,
                        # and `koffi` (the FFI backend of the hosted fs service) is on that list
pnpm -r run build       # every package; the binary it produces is named `envoy-harness`
```

Verified facts worth knowing before you debug a build:

* It is **ten packages** under `packages/` (`envoy-harness`, `-adapter`, `-client`, `-cordis`, `-ehui`,
  `-peer`, `-tui`, `-web`, `envoy-process`, `envoy-sandbox-win`), each built with
  `tsc -p tsconfig.build.json`; the web package also runs `vite build`. An eleventh directory,
  `envoy-harness-python-sdk`, has no `package.json` and is not part of the pnpm build.
* **Every one of them is version `0.0.0`** — a version number here identifies nothing, so a pin must be a
  **commit**, never a range.
* Licence: **Apache-2.0**, with no `NOTICE` file upstream. When we stage its built bundle into the desktop
  app (§3.5), the licence text travels with it; there is no NOTICE to propagate.
* A future `pnpm install` here needs the EnvoyMesh checkout to be **present and readable**, because of the
  overrides above — the two are upgraded as a pair (§2) more often than not.

### 3.3 Wiring our clone in (the milestone-M2 step)

Nothing declares the harness yet — `npm run peers:check` says so in as many words, and treats it as a
requirement the moment a manifest does. When the built-in agent lands:

```jsonc
// the package that drives it, e.g. packages/agent-catalog/package.json
"dependencies": {
  "@envoymesh/envoy-harness": "file:../envoy-harness/packages/envoy-harness"
}
```

Then `npm install` here, and add the pin: a tracked one-line file naming the harness commit, checked by
`peers:check` exactly as it now reports the commit it found. The rule that does **not** bend: never take
it through EnvoyMesh's `file:` link, because that would make us depend on EnvoyMesh for someone else's
package and inherit its release cadence for code it does not own.

### 3.4 Upgrading it

```bash
git -C ../envoy-harness fetch --all --tags
git -C ../envoy-harness checkout <sha>        # the pin, not "whatever main is today"
cd ../envoy-harness && pnpm install && pnpm -r run build
cd ../EnvoyCoder && npm install && npm run gates && npm run smoke
```

Upgrading the harness is a **product decision**, not maintenance: it changes what our agents do. So it is
always a deliberate commit bump with a readable diff, and the smoke run is where you see the consequence —
its agent-catalogue probe must still report the harness present, and the capabilities it advertises
(cancel, approvals, structured tools) are what the UI is allowed to promise. A harness that gains or
loses one of those must change our UI, not silently break a button.

Rolling back is the same three commands with the previous sha.

### 3.5 What ships, and what a user needs

A user never sees any of this. The packaged desktop app **stages the built harness bundle at build time**
(roadmap M6), so an installed EnvoyCoder carries the harness it was built with — no checkout, no
`pnpm install`, no sibling directory. That is also why the release must record the harness commit: it is
the only handle on the agent runtime inside a shipped artifact.

---

## 4. External agent CLIs: nothing to upgrade, by design

`dsh`, `claude`, `codex`, `copilot`, `opencode`, `cursor-agent` and `pi` are the user's own installations.
We neither ship nor update them. We **probe** them (`probeHarness` in `packages/agent-catalog`) and record
what each one supports, so:

* upgrading `dsh` needs no change here — the next probe sees the new version and its capabilities;
* a version that *loses* something (an ACP profile without `session/cancel`, an approval channel that
  cannot be answered) shows up as a capability change, which is exactly what our UI consults before
  offering cancel or an approval dialog;
* a currently-uninstalled agent is reported as absent rather than as broken: `npm run smoke` prints `✓`
  with the path it found, or `·` for one it did not.

The catalogue entries name the evidence for each claim and mark the ones never run against a real binary,
so "we support X" is a statement with a source rather than an assumption.

---

## 5. When a step fails

| Symptom | What it means | Fix |
|---|---|---|
| `warning: N linked package(s) are out of date in the sibling` | you pulled (or someone edited) the sibling without rebuilding; we are running the previous compiled family | step 3 of §2.2 — and until you do, treat a green suite as unproven. The warning clears the moment the rebuild actually happens |
| `ERR_MODULE_NOT_FOUND` from inside a `node_modules/@envoymesh/...` path | the sibling is missing, unbuilt, or a package it needs is absent | `npm run peers:check` — it names the package and prints the exact `tsc -b` command |
| `... is present but not built` | the checkout exists, the build does not | same as above |
| `TS6059` / `TS6307` on unrelated files | a consumer is missing a project reference, or a package is missing from the closure | `npm run wiring:check`; add the reference/manifest entry rather than loosening the tsconfig |
| Type errors appear *in our code* after an upgrade | a contract changed, which is the upgrade doing its job | read the change: adapt here, or if we need a new symbol, take it upstream first (§2.6) |
| Our tests fail on wording or a refusal message | the family changed a sentence deliberately | update **our** assertions to the new contract; never relax a test to make an upgrade pass |
| `smoke` fails on the attach or the LAN leg | a behavioural change types cannot see — token scope, a per-method gate, a capability name | read the node's answer; the legs print it (`UNAUTHORIZED`, the refusal sentence, the grant) |
| Two `tsc -b` runs at once (another window is building the sibling) | two writers, one `tsconfig.tsbuildinfo` — a build state neither would call correct | wait; the upgrade script warns when the sibling's build-info was touched in the last two minutes |
| `pnpm` refuses a postinstall script in the harness | pnpm ≥10 blocks build scripts by default | it is already allowlisted upstream (`onlyBuiltDependencies: koffi`); do not add `--config.enable-pre-post-scripts` |
| Harness build: cannot resolve `@envoymesh/protocol` | the harness is not a sibling of EnvoyMesh (§3.1) | move the clone, or check the checkout the overrides point at exists and is built |

---

## 6. Where each version is visible

| Question | Answer lives in |
|---|---|
| Which EnvoyMesh is this checkout linked to? | `npm run peers:check` → the commit and subject; the upgrade script prints it too; CI logs it |
| Which EnvoyMesh did the family node see? | `ENVOYMESH_VERSION`, recorded in the product session when this app attaches |
| Which harness is this? | `npm run peers:check` → its commit (all ten packages are `0.0.0`, so a version number says nothing); the pin names it once M2 declares the dependency |
| Which family documents were copied, from where? | the header of each file in `docs/family/` (`source-head` + body hash), checked by `npm run docs:check` |
| Which agent CLIs are installed, and what can each do? | `npm run smoke` probe output, and the `evidence` field of each entry in `packages/agent-catalog` |

---

## 7. The checklist, in one place

```bash
# every upgrade
git -C ../EnvoyMesh status --porcelain        # clean, or know why not
npm run upgrade:mesh -- --verify              # §2, or the manual steps
npm run gates && npm run smoke                # §2.5 if the script already verified

# the harness, when its turn comes
git -C ../envoy-harness checkout <sha> && (cd ../envoy-harness && pnpm install && pnpm -r run build)
npm install && npm run gates && npm run smoke

# before a release
npm run upgrade:mesh -- --commit <sha> --verify
npm run docs:check -- --strict                # no stale family documents
# then record both commits in the release notes
```
