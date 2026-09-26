# Roadmap

Every milestone states what it has to **prove**, not what it adds. A milestone that ships screens
without evidence is not done.

**M0 — the scaffold (this commit).** The repo exists, the model and the platform layer are tested,
the UI renders from fixtures, the mobile pairing logic passes its Dart tests, and CI runs on three
operating systems. *Proves:* the shape is buildable and the claims in `docs/` are anchored to code.

**M1 — the daemon serves projects and tasks.** Implement `coder.listProjects`, `addProject`,
`listTasks`, `createTask` over the existing host; persist to `<home>/EnvoyDev/`.
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
> *Amended again, later:* **the `dsh` turn has now been reached**, on 2026-09-20, with the key in the
> launching environment (`DEEPSEEK_API_KEY=… RUN_LIVE_ACP=1 npx vitest run` — the harness's own
> refusal names the variable, and the test's header carries the command). The credential gap is a
> *machine's* state rather than a limitation of the adapter; the sentence above stays because it is
> still what a fresh install meets. That turn also showed the shape of `dsh`'s ACP surface: a plain
> turn publishes `agent_message_chunk` and `usage_update`, and **no `available_commands_update`** — so
> its `/` list is empty in the window and on the phone, while `envoy-harness` publishes its REPL set
> (`../envoy-harness/packages/envoy-harness/src/protocol/slash-dispatch.ts`). Neither is a defect on
> our side: the list belongs to the agent.
>
> **"One adapter covers them" has a precise meaning now** — and it is narrower than it sounded. The
> catalogue records what each agent speaks (`AgentLaunch.transport`): two entries are ACP, and the other
> seven are command lines whose output we would have to parse ourselves. `isDrivableByAcpAdapter()`
> decides, `RunManager` refuses the rest by name with `harnessUnsupported`, and `test/drivable.test.ts`
> pins the split. Fixing the picker's promise cost one field and one guard; leaving it would have cost a
> user a launch that hangs on a handshake no program can answer.
>
> *Amended again, later:* the "two ACP, seven command lines" split was the state when that slice landed,
> and it turned out to under-count the dialect rather than the agents. **Five** entries speak ACP today —
> the two harnesses, plus Claude Code, Codex and Cursor, whose recipes were replaced with commands driven
> against the real binaries (an npm bridge for the first two, Cursor's own `acp` subcommand for the
> third; `docs/settings-parity.md` §7.8). The four that remain are the ones with no ACP surface at all.
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

> **Status: landed (automated half).** Daemon paired-device sessions (`coder.mintPairing` /
> `listPairedDevices` / `revokePairedDevice`) resolve remote tokens; Settings → This machine shows
> a QR; the Flutter app (`apps/mobile`) stores tokens in Keychain/Keystore, dials
> lan → primary → SSH → relay candidates, lists tasks/runs, and answers approvals over `coder.*`.
> Evidence: `apps/desktop/test/daemon-rpc.test.ts` (paired-device), `apps/mobile` Flutter tests (21),
> and the host-connect access-gate fix so non-owner sessions can still call product RPC when
> `socketMethods` is configured. A live phone recording answering an approval remains a manual check.

**M5 — collaborative work (team → job → tasks).** Orchestrator (origin EnvoyDev) creates a
**team** (one copyable team token; members join; online via heartbeat), then **jobs** split into
**tasks** assigned to members (LAN then mesh). Parallel/async where writer locks allow; results
merge on the origin. Failure: retry → reassign → fail with a job report.
*Proves:* D2 + team orchestration. *Acceptance:* team online; job completes across ≥2 members;
named refuse; exhausted task follows §7 policy.
Design: [`docs/envoydev-collaboration.md`](envoydev-collaboration.md) (normative, incl. error matrix).

> **Status:** Local handoff / peer-directory / offer stubs exist (M5a/M5b stepping stones).
> Team token, Job ledger, parallel scheduler, and §7 failure machine are the next slices.

**M6 — packaging.** *Proves:* the app installs and starts on all three platforms, with evidence
in CI rather than unit tests only.

> **What exists today (unsigned builders + resource checks):**
> * macOS: `scripts/build-dmg.sh` → Tauri `dmg,app` (unsigned unless you export signing into Tauri yourself)
> * Windows: `scripts/build-exe.ps1` → NSIS (unsigned)
> * Linux: `scripts/build-linux.sh` → `deb` + AppImage (not rpm)
> * Release workflow: stage bundle + `check-bundle-resources` / installer-script checks — **not** a full
>   `tauri build`, **not** signed/notarised installers, **not** an install-and-launch smoke per OS
>
> **Still open for M6 acceptance:** Apple signing + notarization, Windows code signing, optional rpm/msi
> if we choose to ship them, and CI that installs the package and launches the app on each platform.
>
> **Daemon lifetime (M6 second half) — mostly landed.** App-managed by default; opt-in OS service
> (claim `managedBy`, payload, health/heartbeat, bounds, reconcile, drain, supervisor units, Settings
> row, owner-only RPC). Residuals: `docs/daemon-lifecycle.md` §9–§10.

## Next refinements (backlog)

Ordered after the 2026-09 composer-honesty sprint (gates green, Resume UI, Claude thinking delivery).

| Priority | Item | Notes |
| --- | --- | --- |
| Done | **Appearance: theme** | Settings → Appearance; `theme` on `CoderSettings`; `applyTheme` / light palette already in CSS |
| Done | **Transcript: group tools + emit `run.diff`** | Consecutive tools collapse; daemon emits `run.diff` from write/edit paths before `run.ended` |
| Next | **Appearance: content size** | Font ramp + `contentFontSize` — deferred from theme slice (`settings-parity.md` §8.2) |
| Next | **Codex / Cursor thinking honesty** | Claude `effort` wired. Codex rejects `reasoning_effort` today; Cursor has no `thought_level` |
| Release | **Mobile store: device screenshots + deploy privacy** | Listing URLs filled; re-capture shots at store sizes; deploy `EnvoyMesh/sites/privacy.html` to homeclaw |
| Release | **M6 signing + install smoke** | Unsigned builders exist; signing/notarization and CI install-launch still owed |
| Architecture | **M5 team / job orchestration** | Team-first + orchestrator + §7 failure matrix — `docs/envoydev-collaboration.md` |
| Polish | **History / sidebar nav render** | Model done; UI thin (`paseo-feature-parity` #7) |

## Explicitly not planned

* An account system, telemetry, or a hosted service.
* A second network of our own: the mesh is EnvoyMesh's.
* Running agents in the cloud. Local-first is the product, not a default.
