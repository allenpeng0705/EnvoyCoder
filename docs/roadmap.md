# Roadmap

Every milestone states what it has to **prove**, not what it adds. A milestone that ships screens
without evidence is not done.

**M0 — the scaffold (this commit).** The repo exists, the model and the platform layer are tested,
the UI renders from fixtures, the mobile pairing logic passes its Dart tests, and CI runs on three
operating systems. *Proves:* the shape is buildable and the claims in `docs/` are anchored to code.

**M1 — the daemon serves projects and workspaces.** Implement `coder.listProjects`, `addProject`,
`listWorkspaces`, `createWorkspace` over the existing host; persist to `<home>/EnvoyCoder/`.
*Proves:* a world with two windows attached to one daemon, and the state surviving a restart.
*Acceptance:* the UI stops using fixtures (`apps/desktop/src/data/sample.ts` deleted in the same
commit), and a second window shows the first window's changes without a refresh.

**M2 — one real agent run, end to end.** `envoy-harness` first (in-process, so cancel and approvals
are exact), then `dsh --profile acp` (spawned, so the adapter is proven against a real subprocess).
*Proves:* a task started from the UI appears in the transcript, streams events, and can be cancelled
and resumed. *Acceptance:* the same run driven twice — once through the UI, once through the CLI in
`scripts/` — produces the same event sequence.

**M3 — approvals and the composer.** Answer a permission request inline; Queue and Steer behave
differently and observably. *Proves:* an agent that escalates is answered, not silently denied — the
single most important behaviour for `dsh`, whose SDK profile fails closed on every escalation.
*Acceptance:* an escalation in `dsh --profile acp` is surfaced as a card in the UI and the run
continues; the same escalation with the SDK profile is shown as the reason the run could not
proceed.

**M4 — the phone.** Secure storage for tokens, QR pairing through the EnvoyMesh contract, a host
list with honest connection states, and the run list. *Proves:* a task started at the desk is
visible and answerable from the phone over the mesh, and the app refuses another family app's code
in the family's words. *Acceptance:* a recorded sequence of the phone answering an approval.

**M5 — distributed runs.** A task offered to a peer, accepted or refused by policy, with the events
streamed back to the origin. *Proves:* D2 — the work happens where the code is, and the origin can
watch and steer it. *Acceptance:* a run on machine B whose transcript is complete on machine A, and a
refusal that names the policy that refused it.

**M6 — packaging.** Signed/notarised macOS bundles, NSIS for Windows (**with signing configured —
Paseo ships unsigned Windows builds and its Windows CI never launches the packaged app**), and
AppImage/deb/rpm for Linux. *Proves:* the app installs and starts on all three, with a smoke test in
CI per platform rather than unit tests only.

## Explicitly not planned

* An account system, telemetry, or a hosted service.
* A second network of our own: the mesh is EnvoyMesh's.
* Running agents in the cloud. Local-first is the product, not a default.
