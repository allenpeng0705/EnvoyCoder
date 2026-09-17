# The family documents, copied in

EnvoyDev is built to a standard that lives in **another repository**. These three files are copies
of the EnvoyMesh documents that govern this product, kept here so the rules it is held to can be read
without a second checkout open.

**They are copies, not the authority.** If a copy and its source disagree, the source wins, and the
fix belongs in EnvoyMesh (family guide §7.4) — after which the copy is refreshed, never edited.

| Copy | What it is | The part that concerns this product |
|---|---|---|
| [`envoymesh-new-app-guide.md`](envoymesh-new-app-guide.md) | How to add an app to the family | **Read this first.** The checklist this repo's CI implements: the seven wiring places (§4.1), the shared home (§4.4), attaching to a node (§4.5), the dispatcher (§4.6), owner-granted capabilities (§4.7), and the definition of done (§8) |
| [`envoymesh-multi-product-design.md`](envoymesh-multi-product-design.md) | What happens when two products share one machine | The rules EnvoyDev must not break: one node owner at a time and everyone else attaches (D2), share the local engine and never the cloud (D3), and the harness is a peer each product clones rather than something EnvoyMesh distributes (D4). Also the measurements — a node costs ~650 MB — behind this product running its own host |
| [`envoymesh-refactoring-plan.md`](envoymesh-refactoring-plan.md) | EnvoyMesh's own module refactor | Background, not product design. It is here because the reusable / product-bound split **is** the interface EnvoyDev consumes, and it explains why `@envoymesh/api/core` exists and why the bare `@envoymesh/api` barrel is off limits. EnvoyDev appears in it only as motivation (§1, §11) |

Our own documents are one level up, in [`docs/`](../): the design, the UI, the harness catalogue, the
platform rules, the networking model, the EnvoyMesh integration and the roadmap. Nothing in *this*
folder is ours to write.

## Why a copy is safe to keep

Every file here starts with a header naming its source, the commit it was taken from, the date, and
the SHA-256 of the body as copied. That makes the two ways a copy can go wrong distinguishable — and
deliberately gives them different answers:

- **Someone edited a copy in place.** The body no longer matches the hash in its own header. This is
  always wrong: a mirror was edited, and the next sync would destroy the change. `npm run docs:check`
  **fails**.
- **The source moved on.** The body still matches what was copied, but EnvoyMesh's file has changed
  since. That is ordinary life in a two-repo family, and it must not red-line this repo's CI — a
  document being edited in EnvoyMesh is no reason for EnvoyDev's build to stop. The check reports
  it and **exits 0**; `--strict` turns it into a failure for the moment a release is cut.

```bash
npm run docs:check             # in `npm run gates` and in CI
npm run docs:check -- --strict # before a release: stale copies are an error
npm run docs:sync              # refresh from ../EnvoyMesh (the only way a copy changes)
```

`docs:sync` records `+ uncommitted changes in that repo` when EnvoyMesh's own working tree is dirty,
so a copy never claims a commit it did not come from. The copies' bodies are byte-identical to their
sources — a plain `diff` of a body against the source is empty — because a copy that reformats its
source is a copy you cannot compare.

One consequence of that byte-identity: **a cross-reference inside a copy is written from EnvoyMesh's
root**, so `docs/envoymesh-multi-product-design.md` in a copy means *the file next to this one*, not a
path in this repo. Those links are left alone on purpose — repairing them here would be editing a
mirror, and the next sync would undo it.
