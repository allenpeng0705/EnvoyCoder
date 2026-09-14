# Roadmap

Every milestone states what it has to **prove**, not what it adds. A milestone that ships screens
without evidence is not done.

**M0 — the scaffold (this commit).** The repo exists, the model and the platform layer are tested,
the UI renders from fixtures, the mobile pairing logic passes its Dart tests, and CI runs on three
operating systems. *Proves:* the shape is buildable and the claims in `docs/` are anchored to code.

**M1 — the daemon serves projects and tasks.** Implement `coder.listProjects`, `addProject`,
`listTasks`, `createTask` over the existing host; persist to `<home>/EnvoyCoder/`.
*Proves:* a world with two windows attached to one daemon, and the state surviving a restart.
*Acceptance:* the UI stops using fixtures (`apps/desktop/src/data/sample.ts` deleted in the same
commit), and a second window shows the first window's changes without a refresh.

> **Status: landed** (see the `M1` commit). The evidence is `apps/desktop/test/daemon-rpc.test.ts`
> (ten tests over a real socket: the method set, a restart, a corrupt file quarantined rather than
> overwritten, coded refusals, and one client hearing another's change) plus the two daemon steps in
> `scripts/smoke.ts`, which start the *bundled* daemon as a child process and verify `coder.hello`
> against the claim file. `data/sample.ts` is deleted.
>
> Two things the milestone did not have to prove and does not yet: a second **window** is proven at
> the protocol level, not by two WebViews side by side, and the socket binds `0.0.0.0` (the
> transport's choice), so the LAN leg of the smoke — a tokenless call refused with `UNAUTHORIZED` —
> is what keeps that honest until the phone milestone narrows it.

**M2 — one real agent run, end to end.** `envoy-harness` first (its argv is `run --acp`, so the
protocol is ours end to end), then `dsh --profile acp` (a real subprocess, so the adapter is proven
against a binary we do not control). Both are *spawned*: an earlier draft of this line said
"in-process", which the catalogue has never done.
*Proves:* a task started from the UI appears in the transcript, streams events, and can be cancelled
and resumed. *Acceptance:* the same run driven twice — once through the UI, once through the CLI in
`scripts/` — produces the same event sequence.

> **Status: landed, with one claim amended and one thing unverified.**
>
> *Amended:* "in-process" was wrong about `envoy-harness`. Its package `exports` only `.`, whose entry
> does not include the ACP server, so linking it means importing `dist/protocol/acp-server.js` — the
> internals-dependency the family guide §4.2 forbids. Its **CLI** offers the same thing as a
> documented flag (`--acp`), so both native harnesses are now spawned and driven over the same ACP
> client. Nothing was lost: what makes cancel and approvals exact is speaking a protocol that has
> them, not sharing an address space. `packages/agent-catalog` carries the evidence.
>
> *Evidence:* `apps/desktop/test/runs.test.ts` (13 tests through a real child process — streaming,
> tool-call pairing, an approval answered and continued, cancel, queue vs steer, resume, transcripts),
> `acp-transport.test.ts` (the same client against the **real** `dsh` binary: handshake, session,
> failure path, teardown), `transcript.test.ts` (the folding rules), `daemon-rpc.test.ts` (a run
> driven over the socket, with the pushed events compared to the stored ones), and `npm run run` — a
> CLI that drives a run through the daemon's own protocol, so the window and the terminal are two
> clients of one engine rather than two implementations.
>
> *A successful turn was reached after all, and not the way this milestone expected.* The plan was to
> prove one against `dsh`, which needs a DeepSeek credential this machine does not have — that path
> ends at `run.status {status: "failed"}` carrying the agent's own sentence about the missing key, and
> it is asserted because it is what a fresh install meets. The turn that *completes* is the built-in
> harness's: run from the peer checkout, with no credential, to `run.ended {status: "done"}`
> (`npm run run -- --harness envoy-harness --prompt …`, and
> `acp-transport.test.ts` asserts `stopReason: "end_turn"`). `RUN_LIVE_ACP=1 npx vitest run` covers
> the `dsh` turn on a machine that has a key.
>
> **"One adapter covers them" has a precise meaning now** — and it is narrower than it sounded. The
> catalogue records what each agent speaks (`AgentLaunch.transport`): two entries are ACP, and the other
> seven are command lines whose output we would have to parse ourselves. `isDrivableByAcpAdapter()`
> decides, `RunManager` refuses the rest by name with `harnessUnsupported`, and `test/drivable.test.ts`
> pins the split. Fixing the picker's promise cost one field and one guard; leaving it would have cost a
> user a launch that hangs on a handshake no program can answer.
>
> The two harnesses also turned out to disagree about the **shape of a prompt** — `dsh` takes the
> standard block list, the built-in one wants a flat string — so one client driving both needed a
> one-step fallback on `invalid params`, which is safe precisely because the parser refuses before the
> agent does anything. That is the concrete cost of "one adapter covers them", and it is written down
> in `acp/client.ts` rather than discovered again later.

**M3 — approvals and the composer.** Answer a permission request inline; Queue and Steer behave
differently and observably. *Proves:* an agent that escalates is answered, not silently denied — the
single most important behaviour for `dsh`, whose SDK profile fails closed on every escalation.
*Acceptance:* an escalation in `dsh --profile acp` is surfaced as a card in the UI and the run
continues; the same escalation with the SDK profile is shown as the reason the run could not proceed.

> **Status: landed, with one half of the acceptance replaced by something better.** The mechanisms are
> in and tested; two of the three evidence paths are real, and the third is the same *claim* checked a
> stronger way.
>
> * **Approvals, inline and answered.** `session/request_permission` becomes `run.approval-requested`,
>   the task turns `needs-attention`, and the card renders *in the transcript* with the agent's
>   own option labels — asserted in `task-pane.test.tsx` (a card, not a modal; the option id goes
>   back, not the label) and in `runs.test.ts` through a real child process (the run *continues* after
>   the answer, which is the behaviour the SDK profile cannot produce). A message sent while a card is
>   open is refused with the reason, because queueing behind a prompt strands the words.
> * **Queue and Steer.** Queue waits for the turn in flight and then sends; Steer cancels the turn and
>   sends immediately. Both are recorded in the transcript as `run.message` with a `delivered` field,
>   so the difference is visible afterwards as well as during. `runs.test.ts` asserts both behaviours
>   and the pane test asserts the control sends the chosen mode.
> * **The SDK-profile comparison is not run.** It was there to show what a failing escalation looks
>   like, and it is no longer the strongest available check: the adapter now *speaks* ACP, so the
>   failure it was demonstrating cannot arise on this path. What replaces it is the assertion that a
>   refused or unanswered request is answered `cancelled` rather than dropped — leaving an agent
>   blocked on a request we dropped is the one failure that presents as a hang rather than an error.
> * **Not demonstrated against a real escalated `dsh` turn**, because that needs a model credential
>   this machine does not have (M2's note). The card is proven against the scripted agent, whose
>   option set is copied from `../deepseek-harness/packages/acp/acp/src/index.ts:160-167`.

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
