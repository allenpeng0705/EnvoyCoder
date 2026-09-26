# Collaborative work (M5) — detailed design

M5 is **team-based collaborative work under an orchestrator**, not “offer one run to another
machine.” Remote dial (LAN, then EnvoyMesh) is the **substrate**. Collaboration is the product.

D2 still holds: agents run where the code is; the mesh carries the control plane
([`envoydev-design.md`](envoydev-design.md)). Broker: **daemon-to-daemon**; the EnvoyMesh node is
transport only ([`envoydev-networking.md`](envoydev-networking.md) §6).

This document is the authority for team / job / step / failure logic. Earlier M5a/M5b protocol
stubs (`Task.collaboration`, handoffs, peer directory) are **stepping stones** toward this model;
where they disagree, **this document wins** and the wire catches up in later slices.

**Naming:** the assignment unit under a Job is **`JobStep`** on the wire and in types. The UI
says **Step**. Rail **`Task`** remains everyday single-agent work and must not be overloaded.

---

## 1. Hierarchy (read this first)

```text
Team                    durable roster + team token + per-member join secret
  └── Job               one complex piece of work the orchestrator owns
        └── JobStep     a unit the orchestrator assigned to one member (UI: Step)
              └── Run   one agent turn on that member's machine (existing run.*)
```

| Unit | Created by | Lives on | Purpose |
|---|---|---|---|
| **Team** | Orchestrator (origin EnvoyDev) | Origin | Members online, shared invite credential + per-member proof, roles available |
| **Job** | Orchestrator | Origin | Complex goal; split plan; final report |
| **JobStep** | Orchestrator (split from Job) | Origin (assignment); execute on member | One assignable chunk (UI: **Step**) |
| **Run** | Member daemon | Member (events streamed to origin) | Actual agent execution |
| **Task** (rail) | Human / everyday coding | Local project | Unrelated to JobStep — do not conflate |

**Lifecycle order (mandatory):**

1. Create **Team** (mint token; members join; heartbeats prove online).
2. Create **Job**(s) against that team (only when enough members are online for the roles needed).
3. Orchestrator **splits** the job into **steps** (`JobStep`) and **assigns** them.
4. Members execute **in parallel / asynchronously** where safe.
5. Orchestrator **collects**, **re-organizes**, and **reports** the final result.
6. On failure: **retry → reassign → fail** (see §7) — never silent drop.

Do not invent the team inside every job. A team outlives a job; a job does not outlive its team
token’s validity without rotation.

---

## 2. Roles

| Role | Typical duty | Writer? |
|---|---|---|
| `orchestrate` | Split job, assign, merge report (usually local to origin) | No (control plane) |
| `plan` | Produce a plan / acceptance criteria | No |
| `implement` | Edit the tree | **Yes** |
| `review` | Review diffs / request changes | No |
| `observe` | Read-only watcher | No |

Roles are **labels + policy**, mapped onto agent modes/capabilities when the agent can honour them;
otherwise disabled with a reason ([`paseo-feature-parity.md`](paseo-feature-parity.md)).

---

## 3. Orchestrator

The **orchestrator is the origin EnvoyDev daemon** (control plane), optionally assisted by an
agent with role `orchestrate`. It is **not** the EnvoyMesh node and **not** a third free-floating
service.

```text
Human
  │  (create team, start job, approve risky merges if required)
  ▼
Origin EnvoyDev = Orchestrator
  • mint / rotate / revoke team token
  • membership + heartbeats (online set)
  • create Job, split → JobSteps, assign
  • dial members (LAN first, mesh fallback)
  • retry / reassign / fail policy
  • aggregate run.* + artifacts → final Job report
  │
  ├── local agents (same machine)
  └── peer EnvoyDevs (LAN / mesh) ── stream results home
```

| Responsibility | Orchestrator | Member peer |
|---|---|---|
| Team token mint / revoke / rotate | Yes | No |
| Know members, roles, **connection status**, online state | **Yes (always)** | Own heartbeat only; no view of other peers |
| **Live status of every peer / step** | **Yes (authoritative)** | Reports status; cannot see whole team |
| Split job → steps | Yes | No |
| Assign / reassign steps | Yes | Accept or refuse with policy |
| Execute agent turn | Only for local steps | Yes for assigned steps |
| **Critical actions** (stop, kick, force-fail) | **Yes — see §4.6 / §7.8** | May cancel only its own run |
| Cancel a remote run | Yes (always) | May cancel own run |
| Final result report | Yes | Contributes events only |

An orchestrator **agent** may *propose* a split/assignment; the **daemon** commits offers and
owns the job record. Proposals never dial peers and never hold the team token alone outside the
origin process.

---

## 4. Team and the team token

### 4.1 Why one team token (plus a per-member secret)

Multi-peer setup must be **fast on a PC**: no QR scanning. The orchestrator mints **one unique
team token** (copy/paste). Every member presents that token to join.

Tradeoff (accepted): revoke of a single compromised member requires **rotating the team token**
(everyone rejoins). Optimized for trusted desk / LAN / mesh teams, not hostile multi-tenant SaaS.

**Per-member proof (required).** The shared team token alone must not let peer A heartbeat,
accept, refuse, or report progress as peer B. On join, origin mints a **memberToken** (shown
once; stored hashed as `memberTokenHash`). Heartbeat and pre-auth progress require it
(`apps/desktop/src/daemon/teams.ts:348-371`, `teams.ts:416-421`,
`collab-inbound.ts` `reportJobStepProgress`). Accept/refuse also require `memberToken` plus the
offer’s `cancelNonce` (`collab-handlers.ts` `coder.acceptJobStepOffer` /
`coder.refuseJobStepOffer`). Rotate clears remote `memberTokenHash`s so old member secrets die
with the old invite (`teams.ts:283-291`); rejoin with the same `hostHints` refreshes that roster
row instead of creating a zombie duplicate (`teams.ts:348-371`).

### 4.2 Token rules

| Rule | Detail |
|---|---|
| Mint | Orchestrator only; bound to `teamId` + origin instance |
| Form | High-entropy string; copy/paste; optional typed entry |
| Scope | Join/heartbeat/receive offers for **this team** only — not owner-window powers |
| Expiry | Hard TTL (e.g. 24h default) + idle expiry (default 8h without join/heartbeat/offer activity); shown in UI. **Pre-auth mutators** use the same expiry check as join (`liveTeamTokenPlain` / `requireTeamToken` — `collab-auth.ts:17-44`, `teams.ts:562-570`), not a weaker plaintext match. |
| Rotate | Orchestrator mints new token; old rejected; member tokens cleared; members must rejoin |
| Revoke team | Invalidate token + disconnect all members; jobs on that team → `cancelled` or `failed` per policy |
| Transport | Token is credential; **LAN or mesh only carries bytes** — same Wi‑Fi ≠ trust |
| Member secret | Per-member `memberToken` from join; required on heartbeat / progress / accept / refuse |
| Offer proof | Each `StepOffer` carries `cancelNonce`; accept, refuse, cancel, and inbound approval answers must present it — team token alone is not enough |

### 4.2.1 Pre-auth surface (normative)

Team methods that peers may call without a pairing session are listed in
`COLLAB_PRE_AUTH_METHODS` (`collab-handlers.ts`). Rules that must hold:

| Rule | Evidence |
|---|---|
| Accept requires a real harness `runId`, assignee `memberId`, `memberToken`, and `cancelNonce` | `packages/protocol/src/rpc.ts` `coder.acceptJobStepOffer`; `job-offers.ts` accept path |
| Refuse only while the offer is still `pending` | `job-offers.ts` refuse |
| Accept only if the offer is still the step’s live attempt (blocks stale accept after reassign) | `job-offers.ts` accept live-attempt check |
| Terminal progress only when step is `running`, with `runId === resultRef` | `job-progress.ts` `reportJobStepProgress` |
| Inbound approval answers require `offerId` + `cancelNonce` + a bound run | `collab-inbound.ts` `coder.answerInboundJobStepApproval` |
| Failed origin accept cancels the local orphan run | `collab-inbound.ts` `cancelStartedRun` |
| Member heartbeat forward verifies caller `token`/`memberToken` before using stored secrets | `collab-handlers.ts` `coder.teamHeartbeat` |
| Mesh team session may only call collab pre-auth methods; `params.teamId` must match session team when present | `serve.ts` dispatch |
| Inbound Accept/Refuse are owner-window on the member daemon (not a paired phone) | `collab-inbound.ts` + `requireOwnerWindow` |
| Origin stop / kick / reassign / stall-stop dial `coder.cancelInboundJobStep` before rewriting the ledger | `collab-runtime.ts` `cancelRemoteWork`; `configureRemoteStepCancel` |

### 4.3 Join flow (no QR)

1. Origin: `createTeam` → `{ teamId, token, invite, expiresAt }`.
2. Human shares the invite (token + origin WebSocket URL — chat, password manager, USB).
3. Peer: `joinTeam({ token, label, rolesOffered?, hostHints })`.
4. Origin validates token → adds (or refreshes) member → returns `{ teamId, memberId, team, memberToken }`.
5. Both sides open a control channel (prefer LAN `ws://`, else mesh / SSH). Heartbeats keep `online` and carry `memberToken` + AcceptPolicy.

### 4.4 Connection status (required on the orchestrator)

The orchestrator **must always know the connection status of every team member**. This is not
optional telemetry — scheduling, stall detection, and critical actions (§4.6) all branch on it.

Connection is tracked **separately** from work progress:

| Layer | Question | Signal |
|---|---|---|
| **Connection** | Can we reach this peer’s EnvoyDev? | Control channel + heartbeat |
| **Work progress** | Is it producing results for its task? | `run.*` events at origin (`lastEventAt`) |

A peer can be `online` and still `blocked: "no-progress"`. Both fields appear on the status board.

```
ConnectionStatus = online | connecting | degraded | offline | unknown

ConnectionDetail {
  status: ConnectionStatus,
  transport: lan | mesh | ssh | none,
  endpoint?: string,           // how origin last dialled (no secrets)
  connectedAt?,
  lastHeartbeatAt?,
  lastDialError?,              // envoydev.* code + short reason
  rttMs?,                      // optional; degraded if rising hard
}
```

| Status | Meaning | How decided |
|---|---|---|
| `online` | Channel up; heartbeat within `H` (e.g. 15s) | Heartbeat OK |
| `connecting` | Join or redial in flight | Dial started, not yet first heartbeat |
| `degraded` | Up but late heartbeats, high RTT, or flapping | Missed 1–2 intervals or transport fallback mid-session |
| `offline` | No usable channel / heartbeat past `3H` | Dial fail, close, or timeout |
| `unknown` | Rostered but never successfully connected this session | After join accept, before first dial result |

**Rules:**

1. Origin updates `ConnectionDetail` on join, dial, heartbeat, disconnect, and transport switch
   (LAN → mesh counts as a status event).
2. Assign / reassign only to members with `connection.status === "online"` (or `degraded` if
   job policy allows `allowDegradedAssignees`).
3. Transition to `offline` mid-step → treat as **Peer offline** in §7.2 (retry/reassign path).
4. UI on the origin shows a **per-peer connection chip** (status + transport) on the team and job
   views so the human sees the same truth the orchestrator uses.
5. Peers do **not** see other peers’ connection status — only the orchestrator’s board is
   authoritative (avoids split-brain “I think B is up”).

### 4.5 Peer status board (orchestrator view)

The orchestrator maintains an authoritative **member status board** for the team (and per job).
The human UI and the orchestrator-agent both read this board — peers do not.

```
MemberStatus {
  memberId, label, rolesOffered[],
  connection: ConnectionDetail,   // §4.4 — always present
  currentStepId?, currentRunId?,
  runPhase?: starting | streaming | needs-attention | idle,
  lastEventAt?,          // last run.* received at origin
  blocked?: BlockReason, // work-progress blocks (orthogonal to connection)
  healthNote?,           // short machine-readable + user sentence
}

BlockReason =
  | "no-progress"        // running but no run.* for T_stall (peer may still be online)
  | "needs-attention"    // approval/question unanswered past T_approval
  | "heartbeat-miss"     // maps toward connection.degraded / offline
  | "offer-unacked"      // offer sent, no accept/refuse
  | "cancel-pending"     // stop sent, peer not confirmed
```

**Stalled / blocked to return a result** means: the step is non-terminal on that member, and either
`blocked` is set or `lastEventAt` is older than `T_stall` (default e.g. 60s while `runPhase` is
`streaming` / `starting`). Needs-attention uses a longer `T_approval` (e.g. 5–15 min) so humans
can answer without false stalls.

Heartbeats alone are not enough: a peer can be `online` yet produce no transcript. Progress is
**events arriving at the origin**, not merely a live socket. Connection status answers
reachability; `lastEventAt` / `blocked` answer “are we getting results?”

### 4.6 Critical actions (orchestrator may take)

When a peer is blocked, offline, or misbehaving, the orchestrator (human click or automated
policy) may:

| Action | Effect | When to use |
|---|---|---|
| **Stop run** | Origin sends cancel to that member’s current run; attempt → `cancelled` | Stuck streaming; wrong path; human abort |
| **Stop step** | Cancel offer + run; step → `cancelled` or enter retry/reassign (§7.3) | Step must not continue on this peer |
| **Force-fail step** | No more retries on this assignee; go to reassign or fail-step | Peer loops / poison results |
| **Reassign now** | Skip remaining retries; pick another online member | Clear that this peer cannot finish |
| **Kick member** | Drop from team roster for this token generation; cancel their in-flight work | Bad actor, long offline, refuse to stop |
| **Rotate team token** | Everyone rejoins; in-flight jobs follow `onTeamRevoked` | Credential leak or mass kick |
| **Pause job** | No new offers; running steps may finish or be stopped per flag | Human wants a freeze |
| **Fail / cancel job** | Terminal job; stop all member runs best-effort | Unrecoverable |

**Authority:** only the origin may issue these. A peer that ignores **Stop run** past
`T_cancel_ack` is treated as offline → kick or reassign; the attempt is marked `abandoned`.

Automated policy (optional, per job):

```
StallPolicy {
  T_stallMs,              // default 60000
  T_approvalMs,           // default 600000
  T_cancelAckMs,          // default 10000
  onStall: "stop-and-retry" | "stop-and-reassign" | "alert-only",
  onStopIgnored: "kick" | "abandon-and-reassign",
}
```

Default `onStall`: **stop-and-retry** once on the same peer, then **stop-and-reassign** (still
bound by `maxReassigns` and writer-lock rules in §7.3).

**Ship gate (normative):** do **not** enable `StallPolicy` automation (`onStall` stop/kick) until
the origin **status board** (§4.5) and **ledger notes** for stop/reassign are visible in the UI.
Ship order: board → manual critical actions → then `onStall`. Silent automated stops are forbidden.

### 4.7 Accept policy (member)

Offers are **manual by default**. Auto-accept is a member-local setting, never an origin push.

```
AcceptPolicy {
  mode: "manual" | "auto-roles",   // default "manual"
  autoAcceptRoles?: Role[],        // only when mode is auto-roles
}
```

| Rule | Detail |
|---|---|
| Default | `mode: "manual"` — human at the peer machine confirms Accept / Refuse |
| Auto | Member may set `autoAcceptRoles` (e.g. `plan`, `review`) on **that** machine’s Teams settings |
| Writer | **`implement` never auto-accepts** unless the human explicitly lists `implement` in `autoAcceptRoles` |
| Origin | Cannot force auto-accept on peers |

## 5. Job and JobStep

### 5.1 Job

```
Job {
  id, teamId, title, goal,
  status: drafting | running | merging | done | failed | cancelled,
  steps: JobStepId[],
  finalReport?: { summary, artifacts[], failures[] },
  policy: FailurePolicy,   // see §7
  stallPolicy?: StallPolicy,  // inactive until §4.6 ship gate is met
  createdAt, updatedAt, endedAt?
}
```

### 5.2 JobStep (assignment unit; UI: Step)

```
JobStep {
  id, jobId,
  role,                 // required role to execute
  brief,                // what to do
  worktreeKey,          // lock key: same key ⇒ at most one writer
  cwdHint,              // absolute path or project-relative key the member must resolve
  dependsOn?: JobStepId[],
  assigneeMemberId?,
  status: pending | offered | running | succeeded | failed | cancelled,
  attempts: Attempt[],  // peer, startedAt, endedAt, error?, outcome
  resultRef?,           // pointer to streamed transcript / diffs / notes
}
```

### 5.3 Parallelism

| Allowed in parallel | Forbidden |
|---|---|
| Steps with **different** `worktreeKey`, or non-writer roles | Two **writer** (`implement`) steps on the **same** `worktreeKey` |
| Plan / review / observe alongside remote implement on another tree | Silent multi-writer on one cwd |
| Async completion; orchestrator merges when dependencies satisfied | Assuming wall-clock order without a merge plan |

Dependency edges (optional): `JobStep.dependsOn: JobStepId[]`. A step is schedulable only when
dependencies are `succeeded` (or explicitly `skipped` by policy).

---

## 6. Distribution and results

### 6.1 Assign

1. Pick online members whose offered roles include `step.role`.
2. Prefer sticky assignee (same member who succeeded a related step) when still online.
3. Send **offer** (required fields):

```
StepOffer {
  offerId, jobId, stepId,
  brief, role,
  worktreeKey,
  cwdHint,              // REQUIRED — member must resolve before accept
  deadline?,
}
```

4. Member resolves `cwdHint` to a local directory. If missing or not a directory → **refuse** with
   `envoydev.peer-refused` and policy `path-missing`. Origin never assumes the peer’s home path.
5. Member **accepts** (manual, or per §4.7) → starts Run → streams `run.*` to origin; or
   **refuses** with a named policy.

### 6.2 Connect path (simple)

Same order as the phone ([`envoydev-networking.md`](envoydev-networking.md) §5):

1. **LAN / direct** `ws://` if reachable  
2. Else **EnvoyMesh** relay  
3. Optional later: SSH  

UI never asks “LAN or mesh”; the dialer does. Agents never dial — only EnvoyDev ↔ EnvoyDev.

### 6.3 Collect and organize

Origin appends every member’s `run.*` (and handoff / attempt records) into the **job ledger**.
When all steps are terminal:

- **done** — merge summaries, diffs, and notes into `finalReport`
- **failed** — `finalReport.failures[]` lists every failed step, attempts, and last error
- **cancelled** — human or team revoke stopped the job

The final report is always produced on the **origin**. Peers do not hold the merged result.

---

## 7. Error and exception handling (normative)

### 7.1 Failure policy (per job)

```
FailurePolicy {
  maxRetriesPerAssignee: number,     // default 2 (3 attempts total on same member)
  retryBackoffMs: number,            // default 2000, exponential cap 30s
  maxReassigns: number,              // default 1
  onStepExhausted: "fail-job" | "continue-partial",  // default fail-job for writer steps
  onPeerRefuse: "reassign" | "fail-step",            // default reassign if another candidate
  onTeamRevoked: "cancel-job",
  allowDegradedAssignees?: boolean,  // default false
}
```

### 7.2 Classification

| Class | Examples | First response |
|---|---|---|
| **Transient** | Timeout, disconnect, heartbeat miss mid-run | Retry **same** member after backoff |
| **Peer offline** | No heartbeat; dial failed | After retries → **reassign** if candidate exists |
| **Policy refuse** | `peer-refused` with named policy (incl. `path-missing`) | **Do not** blind-retry; reassign or fail-step |
| **Agent failed** | Run `failed` / non-zero logic error | Retry same member up to `maxRetriesPerAssignee` |
| **Writer lock conflict** | Second implement on same `worktreeKey` | Refuse schedule (orchestrator bug if offered) |
| **No candidate** | Role has no online member | Fail-step; if writer or `fail-job` → fail job |
| **Team token expired / rotated** | Join or heartbeat rejected | Member marked offline; in-flight → cancel or reassign |
| **Origin cancel** | Human stop | Cancel offers + runs; job `cancelled` |
| **Partial merge conflict** | Parallel results disagree | Job `merging` → human or orchestrator-agent resolves; else `failed` with both artifacts retained |
| **Stalled / blocked** | Online but no `run.*` for `T_stall`, or approval past `T_approval` | §4.6 critical action (`onStall`); then §7.3 — automation only after ship gate |
| **Stop ignored** | Cancel sent, no ack in `T_cancelAckMs` | `onStopIgnored`: abandon attempt; kick or reassign |

### 7.3 Retry → reassign → fail (per step)

```text
                ┌──────────────┐
                │ Step running │
                └──────┬───────┘
                       │ error / disconnect / failed
                       ▼
              attempts < max+1
              on same assignee?
                  │ yes              │ no
                  ▼                  ▼
            retry same         another ONLINE
            (backoff)          member with role?
                                  │ yes         │ no
                                  ▼             ▼
                            reassign        fail step
                            (record)        ──► onStepExhausted
                                                fail-job | continue-partial
```

**Rules:**

1. Every attempt is appended to `JobStep.attempts` (memberId, error code, message, at).
2. Reassign increments `reassignCount`; stop at `maxReassigns`.
3. Reassign is **forbidden** when the step is a writer and no other member shares that
   `worktreeKey` / path — fail-step instead (do not invent a second writer elsewhere silently).
4. Policy refuse never burns a retry slot on the same member for the same reason.
5. Cap total wall time per step (`deadline`); on expiry treat as transient then offline path.

### 7.4 Job-level outcomes

| Situation | Job status | Report |
|---|---|---|
| All steps succeeded | `done` | Full merge |
| Writer step exhausted + `fail-job` | `failed` | Failures + successful siblings retained |
| Non-writer exhausted + `continue-partial` | `done` or `failed` (configurable) | Mark gaps in report |
| Team revoked / token rotated mid-job | `cancelled` | Who was cut off |
| Human cancel | `cancelled` | Partial artifacts kept |

### 7.5 Exception surfaces (wire codes)

Reuse / extend `envoydev.*` rather than inventing silent empties:

| Code | When |
|---|---|
| `envoydev.peer-refused` | Member refuse; `policy` required (e.g. `path-missing`) |
| `envoydev.bad-request` | Illegal schedule (double writer, unknown step) |
| `envoydev.unauthorized` | Bad / expired team token |
| `envoydev.daemon-unreachable` | Dial/heartbeat failure class |
| `envoydev.harness-failed` | Agent run failed after accept |
| (new) `envoydev.team-expired` | Token TTL / rotate |
| (new) `envoydev.step-exhausted` | Retries+reassigns used up |
| (new) `envoydev.job-failed` | Job terminal failure |

UI shows **headline + policy/error**, never a raw stack to end users. Attempts stay in the job ledger
for support.

### 7.6 Idempotency and double delivery

- Offers carry `offerId`; accept twice is a no-op with the same run.
- Event `seq` per run detects gaps; origin requests replay or marks `hasGap` in the ledger.
- Reassign cancels in-flight offer on the old member before activating the new one (best-effort;
  if old member is offline, mark attempt `abandoned` and proceed).

### 7.7 Approvals mid-flight

Permission prompts still render **inline on the run** (M4 honesty). The **origin** (and phone as
client of origin) **and** the member machine may show the same card. **First successful answer
wins**; a second answer is an idempotent no-op (`already-resolved`). If the assignee goes offline
while `needs-attention`, treat as transient → offline path after timeout (do not leave the job
wedged forever).

### 7.8 Stalls and critical stops (detail)

1. Orchestrator evaluates the status board on a timer (e.g. 1s) and on every inbound event.
2. If `blocked: "no-progress"` or `"needs-attention"` past threshold → apply `StallPolicy.onStall`
   **only when the §4.6 ship gate is met** (board + ledger notes visible). Until then, surface
   blocked state and wait for human Stop / Reassign.
3. **Stop run** is always allowed from origin, including when the human presses Stop on the job UI
   for one peer row — not only when automation fires.
4. After stop: prefer clean `run.ended { cancelled }`; if missing, mark attempt `abandoned` and
   free the `worktreeKey` lock so a reassigned writer may proceed.
5. Results already streamed remain in the job ledger (partial credit); the final report names the
   stop reason (`orchestrator-stop`, `stall`, `kick`, …). Every automated stop **must** write a
   ledger note — silent automation is forbidden.

---

## 8. Logic review (checklist)

Before implementing a slice, these must hold:

1. **Team before job** — no job without a team; no assign to offline members.
2. **Team token + member proof** — copy/paste invite; rotate to revoke; `memberToken` +
   `cancelNonce` on pre-auth mutators (§4.1–§4.2.1).
3. **Orchestrator = origin** — only place that mints tokens, assigns, merges reports.
4. **One writer per worktreeKey** — parallel elsewhere is encouraged.
5. **Retry then reassign then fail** — always recorded; refuse ≠ retry.
6. **Cancel / stop always works from origin** — including remote runs; ignored stop → abandon + kick/reassign.
7. **Status board is authoritative on origin** — **connection status per peer** (§4.4) plus work
   progress; stalled peers are visible; critical actions (§4.6) are first-class.
8. **Final report on origin** — peers never “own” the merged outcome.
9. **LAN then mesh** — transport detail, not a user choice.
10. **Node is not the orchestrator** — mesh carries bytes only.
11. **JobStep ≠ rail Task** — wire type `JobStep`; UI “Step”; rail Task unchanged (§1).
12. **Offer carries `cwdHint`** — member resolves or refuses `path-missing` (§6.1).
13. **Accept is manual by default** — §4.7; `implement` never silent-auto.
14. **Stall automation gated** — board + ledger notes before `onStall` (§4.6).

---

## 9. Mapping to what already exists

| Shipped / stubbed | Role in this design |
|---|---|
| `Task.collaboration` + handoffs + `run.handoff` | Local multi-agent rehearsal of assign/handoff |
| `coder.listPeers` / `registerPeer` / `forgetPeer` | Temporary directory until Team join exists |
| `coder.offerParticipantRun` + accept/refuse | Prototype of step offer |
| Phone pairing (QR) | **Different** product: owner’s phone client — not team join |
| Team / Job / JobStep / team token / retry matrix | **Wired** — invite join, inbound offers, runs, §7, heartbeats, remote stop; pre-auth auth (§4.2.1: expiry, memberToken, cancelNonce, live-offer accept, remote cancel on kick/reassign/stall); stall toggle gated; two-daemon loopback proof |

Implementation order (normative ship gate for stall):

1. **Team + token + heartbeat + join** (copy/paste)
2. **Job + JobStep ledger + assign/offer** (with `cwdHint`) on top of / beside existing offer RPC
3. **Origin UI**: Teams page + Job pane status board + **manual** critical actions + ledger notes
4. **Parallel scheduler + worktree locks**
5. **§7 failure machine** (retry/reassign/fail + report)
6. **LAN → mesh → SSH dial** for member channels (SSH tunnel + mesh CLIENT_PROXY)
7. **`StallPolicy` automation** — only after step 3 is visible
8. Orchestrator-agent assist (`orchestrate` role / suggest steps)

---

## 10. Non-goals

- QR-based team join (PC-hostile); phone pairing QR remains for M4 only  
- One immortal shared token with no TTL/rotate  
- Mesh node as job orchestrator  
- Cloud-hosted agents  
- Unbounded multi-writer on one tree  
- Phone as a peer implementer by default (phone remains client of origin)  
- A third permanent sidebar level that competes with Project → Task for everyday single-agent work

---

## 11. UI / UX design

Follows [`envoydev-ui.md`](envoydev-ui.md): **headline first, detail second, developer fields last**;
dot-then-words for status; **one attention number**; approvals **inline, never modal**; sentence
case. Collaboration must not invent a second visual language.

### 11.1 Information architecture (reconcile with “two levels”)

[`envoydev-ui.md`](envoydev-ui.md) §1: **project = place, task = unit of work** — two levels for
everyday coding. Collaboration adds Team and Job **without** making the rail three deep for normal
work:

| Concept | Where it lives in the UI |
|---|---|
| **Team** | Settings-adjacent surface: **Teams** (or Mesh → Teams). Not a rail tree node for every repo. |
| **Job** | Appears in the **rail as a job row** under the project that owns the work (or a top “Jobs” filter). Opening it opens the **Job pane**. |
| **Task** (job child) | Rows **inside the Job pane** (checklist / board), not separate rail entries by default — avoids “project → job → task” fatigue. |
| **Run** | Transcript region inside the Job pane (per-task tabs or a unified ledger with peer labels). |

Everyday single-agent tasks stay Project → Task. Jobs are an **opt-in mode** once a team exists.

**Naming in the UI (user language):**

| Internal | On screen |
|---|---|
| Team | Team |
| Job | Job |
| Task (rail) | Task — everyday single-agent work |
| JobStep | **Step** — never “task” next to rail tasks |
| Run | (no extra word — show agent output) |
| Member | Machine / teammate (prefer the member’s `label`) |
| Orchestrator | **This machine** or omitted — users “run the job,” they don’t manage an orchestrator |

### 11.2 Origin surfaces (orchestrator human)

**A. Teams page (setup)**

```
Teams
  [Create team]

  ▼ Desk + lab                          token expires in 18h
     Members
       ● workstation   online · LAN      implement, review
       ● laptop        degraded · mesh   plan
       ○ build-box     offline           implement
     [Copy team token]  [Rotate token]  [Dissolve team]
```

- **Create team** → show token once in a copy field + expiry; “Share this token with other
  EnvoyDev machines (Paste in Join team).” No QR.
- Member rows: **connection chip first** (colour = §4.4 status), then label, then roles.
- Rotate / Dissolve are **destructive**: confirm with the consequence (“everyone must paste a new
  token”; “running jobs will cancel”).

**B. Join team (member machine)**

Simple full-page or Settings card: **Paste team token** → **Join**. On success: “Joined *Desk +
lab* as *laptop*.” Offer role checkboxes (implement / review / …). No peer list of others’ IPs.

**C. Job pane (primary orchestration UX)**

```
┌ Job: Wire attach into node service          [Running]  [Pause] [Stop job]
│ Team: Desk + lab · 2 online / 1 offline
├──────────── Steps ────────────┬──────── Peers ─────────
│ ● 1 Plan          done   desk │ ● workstation  online LAN
│ ● 2 Implement     running·ws  │   Step 2 · streaming
│ ○ 3 Review        waiting     │ ● laptop       degraded
│                               │ ○ build-box    offline
├───────────────────────────────┴────────────────────────
│ Transcript / ledger  (filter: All | Step 2 | workstation)
│  … run.handoff / assistant / tools …
│  ┌ approval inline if needs-attention on any step ───┐
│  └───────────────────────────────────────────────────┘
│ [Stop step] [Reassign…] [Open report]
└
```

Rules:

1. **Peers column = connection + work**, same board as §4.5 — not a second inventing of status.
2. Critical actions on a peer row: **Stop**, **Reassign**, **Kick** behind `…` with confirm for Kick.
3. Job-level **Stop** confirms (“stop all steps on all machines?”).
4. Attention: any step `needs-attention` contributes to the **same** rail `attentionSummary` — one
   amber number, never a second “job alerts” counter ([`envoydev-ui.md`](envoydev-ui.md) §4).
5. While a step streams, the ledger shows **which machine** on each block (quiet meta line), so
   parallel steps stay readable.
6. Final report is a first-class end state: headline outcome, then failures/attempts, then artifacts
   — not a raw JSON dump.

**D. Creating a job**

1. Pick team (must have ≥1 online member for required roles — else disable Start with reason).
2. Goal text (the complex job).
3. Optional: “Suggest steps” (orchestrator-agent) → editable step list before Start.
4. Start → assignments go out; user watches Job pane.

### 11.3 Member machine UX (peer)

Peers are **workers**, not second orchestrators:

| See | Do not see |
|---|---|
| Own connection to origin (connected / reconnecting) | Other peers’ connection board |
| Incoming **step offer** (headline brief + role + Accept / Refuse) | Full job split editor |
| Own run transcript + inline approvals | Kick / rotate / dissolve |
| “Origin stopped this step” | Team token after join (stored; not re-displayed in chrome) |

Offer card copy: headline = brief; detail = job title + role; refuse asks for a short reason
(maps to policy name when possible).

Auto-accept follows §4.7: **off by default**; power users may enable “Auto-accept steps for
role X” on that member — never silent for `implement` without an explicit listing. On the **origin**,
local pending offers appear in the Job pane (Accept / Refuse) when This machine’s AcceptPolicy is
manual; the same auto-accept checkbox lives on the peer row for This machine.

### 11.4 Status language (shared palette)

Reuse existing semantic colours ([`envoydev-ui.md`](envoydev-ui.md) §3):

| State | Dot / chip |
|---|---|
| online / streaming | blue (working) |
| needs-attention | amber |
| failed / exhausted | red |
| done | green |
| offline / cancelled | grey |
| degraded | amber outline or muted blue + “Unstable link” |

Connection chip text examples: **Online · LAN**, **Unstable · Mesh**, **Offline**, **Connecting…**
Never show multiaddrs or tokens in the chip.

### 11.5 Critical-action UX

| Action | Affordance | Confirm? |
|---|---|---|
| Stop step | Primary on peer/step row when running | No (reversible via reassign) |
| Reassign | Secondary | Name the next machine if known |
| Kick | Menu | **Yes** — “Remove *workstation* from the team. Their step will stop.” |
| Rotate token | Teams page | **Yes** — everyone must rejoin |
| Force-fail step | Secondary on step row | **Yes** — marks exhausted / fails per job policy |

After Stop / Kick, toast or quiet note in ledger: “Stopped step 2 on workstation — reassigning…”
so automation is never silent.

### 11.6 Empty, error, and waiting states

- No team: Job create disabled — “Create a team and have at least one machine join.”
- Team, all offline: “No machines online. Steps will wait until someone reconnects.”
- Stall automation fired: ledger note + peer chip **Blocked · no progress**.
- Partial job done: report banner **Finished with gaps** + list of failed steps.
- Token expiring &lt; 2h: Teams banner **Team token expires soon** + Rotate.

### 11.7 Phone (M4 client of origin)

Phone may **watch** job status and **answer approvals** for the origin’s job (same as today for
tasks). It does **not** create teams, mint tokens, or kick peers in v1 — keeps the phone a thin
client of the orchestrator machine.

### 11.8 Accessibility and density

- Connection + step status are text, not colour alone.
- Peer column collapses under Steps on narrow widths; connection chips remain on step rows.
- No emoji status; no dashboard card grid in the job hero — one composition: title, status, steps,
  peers, ledger ([frontend design rules](envoydev-ui.md) applied to this pane).

---

## 12. Design review findings (logic + UX)

Reviewed against §§1–11 and [`envoydev-ui.md`](envoydev-ui.md). Outcomes folded into the doc above;
remaining implementation risks called out here.

### 12.1 Logic — sound

- Team → Job → Step → Run order is consistent.
- Connection vs progress split prevents “socket up ⇒ healthy.”
- Retry → reassign → fail with writer-lock guard is coherent.
- Origin-only critical actions avoid split-brain control.
- Single team token matches the “fast PC setup” goal with an honest revoke tradeoff.

### 12.2 Logic — resolved gaps

| Gap | Resolution |
|---|---|
| Existing protocol `Task` ≠ job child | **Resolved §1 / §5** — types `Team` / `Job` / `JobStep`; UI “Step”; rail `Task` unchanged |
| Who auto-accepts offers? | **Resolved §4.7** — default manual; optional per-role auto-accept; `implement` never silent |
| Two windows on origin | **Resolved §7.6** — same daemon; status board shared; actions idempotent |
| Member’s local project path | **Resolved §6.1** — offer requires `cwdHint`; refuse `path-missing` if unresolved |
| Approval on member while human watches origin | **Resolved §7.7** — first successful answer wins; second is already-resolved |
| Silent stall-stop | **Resolved §4.6 / §9** — ship gate: board + ledger notes before `onStall` |
| Reference typo §3 → critical actions | **Resolved** — critical actions are **§4.6** |

### 12.3 UX — risks to avoid

| Risk | Mitigation |
|---|---|
| Third rail level | Jobs as rows / filter; steps inside pane (§11.1) |
| Two attention counts | One `attentionSummary` including job steps (§11.2) |
| Token fatigue | Copy once at create; expiry banner; rotate with confirm |
| Action overload | Stop/Reassign visible; Kick/Rotate behind confirm |
| Parallel transcript chaos | Filter by step/peer; label each block with machine |
| Peer feels like a dumb terminal | Clear offer cards + own transcript + refuse with reason |

### 12.4 Verdict

The control-plane design is **ready to implement behind Team/Job/JobStep types**. UI ships in
this order: **Teams (create/join/token/connection chips) → Job pane (steps + peers + stop/reassign)
→ failure machine + report → LAN/mesh dial → stall automation → orchestrator-agent suggest steps**.
Do not ship critical automation (`onStall` stop/kick) without the status board and ledger notes
visible — silent stops train users to distrust the product.

---

## Related

* Roadmap M5: [`roadmap.md`](roadmap.md)  
* Networking: [`envoydev-networking.md`](envoydev-networking.md) §5–§6  
* Shell / rail / attention: [`envoydev-ui.md`](envoydev-ui.md)  
* Design decisions: [`envoydev-design.md`](envoydev-design.md) D2/D3 and §7  
