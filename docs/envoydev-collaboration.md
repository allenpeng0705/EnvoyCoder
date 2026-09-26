# Collaborative work (M5) — detailed design

M5 is **team-based collaborative work under an orchestrator**, not “offer one run to another
machine.” Remote dial (LAN, then EnvoyMesh) is the **substrate**. Collaboration is the product.

D2 still holds: agents run where the code is; the mesh carries the control plane
([`envoydev-design.md`](envoydev-design.md)). Broker: **daemon-to-daemon**; the EnvoyMesh node is
transport only ([`envoydev-networking.md`](envoydev-networking.md) §6).

This document is the authority for team / job / task / failure logic. Earlier M5a/M5b protocol
stubs (`Task.collaboration`, handoffs, peer directory) are **stepping stones** toward this model;
where they disagree, **this document wins** and the wire catches up in later slices.

---

## 1. Hierarchy (read this first)

```text
Team                    durable roster + connectivity + one team token
  └── Job               one complex piece of work the orchestrator owns
        └── Task        a unit the orchestrator assigned to one member
              └── Run   one agent turn on that member's machine (existing run.*)
```

| Unit | Created by | Lives on | Purpose |
|---|---|---|---|
| **Team** | Orchestrator (origin EnvoyDev) | Origin | Members online, shared credential, roles available |
| **Job** | Orchestrator | Origin | Complex goal; split plan; final report |
| **Task** | Orchestrator (split from Job) | Origin (assignment); execute on member | One assignable chunk |
| **Run** | Member daemon | Member (events streamed to origin) | Actual agent execution |

**Lifecycle order (mandatory):**

1. Create **Team** (mint token; members join; heartbeats prove online).
2. Create **Job**(s) against that team (only when enough members are online for the roles needed).
3. Orchestrator **splits** the job into tasks and **assigns** them.
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
  • create Job, split → Tasks, assign
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
| Know members, roles, online state | Yes | Own heartbeat only |
| **Live status of every peer / task** | **Yes (authoritative)** | Reports status; cannot see whole team |
| Split job → tasks | Yes | No |
| Assign / reassign tasks | Yes | Accept or refuse with policy |
| Execute agent turn | Only for local tasks | Yes for assigned tasks |
| **Critical actions** (stop, kick, force-fail) | **Yes — see §4.5 / §7.8** | May cancel only its own run |
| Cancel a remote run | Yes (always) | May cancel own run |
| Final result report | Yes | Contributes events only |

An orchestrator **agent** may *propose* a split/assignment; the **daemon** commits offers and
owns the job record. Proposals never dial peers and never hold the team token alone outside the
origin process.

---

## 4. Team and the single team token

### 4.1 Why one team token

Multi-peer setup must be **fast on a PC**: no QR scanning. The orchestrator mints **one unique
team token** (copy/paste). Every member presents that token to join.

Tradeoff (accepted): revoke of a single compromised member requires **rotating the team token**
(everyone rejoins). Optimized for trusted desk / LAN / mesh teams, not hostile multi-tenant SaaS.

### 4.2 Token rules

| Rule | Detail |
|---|---|
| Mint | Orchestrator only; bound to `teamId` + origin instance |
| Form | High-entropy string; copy/paste; optional typed entry |
| Scope | Join/heartbeat/receive offers for **this team** only — not owner-window powers |
| Expiry | Hard TTL (e.g. 24h default) + idle expiry; shown in UI |
| Rotate | Orchestrator mints new token; old rejected; members must rejoin |
| Revoke team | Invalidate token + disconnect all members; jobs on that team → `cancelled` or `failed` per policy |
| Transport | Token is credential; **LAN or mesh only carries bytes** — same Wi‑Fi ≠ trust |

### 4.3 Join flow (no QR)

1. Origin: `createTeam` → `{ teamId, token, expiresAt }`.
2. Human shares token (chat, password manager, USB — out of band).
3. Peer: `joinTeam({ token, label, rolesOffered?, hostHints })`.
4. Origin validates token → adds member → returns `{ teamId, memberId, peersSummary }`.
5. Both sides open a control channel (prefer LAN `ws://`, else mesh). Heartbeats keep `online`.

### 4.4 Online / connected

A member is **online** only if the last heartbeat is within `H` (e.g. 15s) **and** the control
channel is up. Jobs that need role `R` may start only when ≥1 online member offers `R` (or the
orchestrator is that role locally).

### 4.5 Peer status board (orchestrator view)

The orchestrator maintains an authoritative **member status board** for the team (and per job).
The human UI and the orchestrator-agent both read this board — peers do not.

```
MemberStatus {
  memberId, label, rolesOffered[],
  connection: online | degraded | offline,
  lastHeartbeatAt,
  transport: lan | mesh | unknown,
  currentTaskId?, currentRunId?,
  runPhase?: starting | streaming | needs-attention | idle,
  lastEventAt?,          // last run.* received at origin
  blocked?: BlockReason, // see below
  healthNote?,           // short machine-readable + user sentence
}

BlockReason =
  | "no-progress"        // running but no run.* for T_stall
  | "needs-attention"    // approval/question unanswered past T_approval
  | "heartbeat-miss"     // channel up historically, heartbeat late
  | "offer-unacked"      // offer sent, no accept/refuse
  | "cancel-pending"     // stop sent, peer not confirmed
```

**Stalled / blocked to return a result** means: the task is non-terminal on that member, and either
`blocked` is set or `lastEventAt` is older than `T_stall` (default e.g. 60s while `runPhase` is
`streaming` / `starting`). Needs-attention uses a longer `T_approval` (e.g. 5–15 min) so humans
can answer without false stalls.

Heartbeats alone are not enough: a peer can be “online” yet produce no transcript. Progress is
**events arriving at the origin**, not merely a live socket.

### 4.6 Critical actions (orchestrator may take)

When a peer is blocked, offline, or misbehaving, the orchestrator (human click or automated
policy) may:

| Action | Effect | When to use |
|---|---|---|
| **Stop run** | Origin sends cancel to that member’s current run; attempt → `cancelled` | Stuck streaming; wrong path; human abort |
| **Stop task** | Cancel offer + run; task → `cancelled` or enter retry/reassign (§7.3) | Task must not continue on this peer |
| **Force-fail task** | No more retries on this assignee; go to reassign or fail-task | Peer loops / poison results |
| **Reassign now** | Skip remaining retries; pick another online member | Clear that this peer cannot finish |
| **Kick member** | Drop from team roster for this token generation; cancel their in-flight work | Bad actor, long offline, refuse to stop |
| **Rotate team token** | Everyone rejoins; in-flight jobs follow `onTeamRevoked` | Credential leak or mass kick |
| **Pause job** | No new offers; running tasks may finish or be stopped per flag | Human wants a freeze |
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

## 5. Job and Task

### 5.1 Job

```
Job {
  id, teamId, title, goal,
  status: drafting | running | merging | done | failed | cancelled,
  tasks: TaskId[],
  finalReport?: { summary, artifacts[], failures[] },
  policy: FailurePolicy,   // see §7
  createdAt, updatedAt, endedAt?
}
```

### 5.2 Task (assignment unit)

```
Task {
  id, jobId,
  role,                 // required role to execute
  brief,                // what to do
  worktreeKey,          // lock key: same key ⇒ at most one writer
  assigneeMemberId?,
  status: pending | offered | running | succeeded | failed | cancelled,
  attempts: Attempt[],  // peer, startedAt, endedAt, error?, outcome
  resultRef?,           // pointer to streamed transcript / diffs / notes
}
```

### 5.3 Parallelism

| Allowed in parallel | Forbidden |
|---|---|
| Tasks with **different** `worktreeKey`, or non-writer roles | Two **writer** (`implement`) tasks on the **same** `worktreeKey` |
| Plan / review / observe alongside remote implement on another tree | Silent multi-writer on one cwd |
| Async completion; orchestrator merges when dependencies satisfied | Assuming wall-clock order without a merge plan |

Dependency edges (optional): `Task.dependsOn: TaskId[]`. A task is schedulable only when
dependencies are `succeeded` (or explicitly `skipped` by policy).

---

## 6. Distribution and results

### 6.1 Assign

1. Pick online members whose offered roles include `task.role`.
2. Prefer sticky assignee (same member who succeeded a related task) when still online.
3. Send **offer** `{ jobId, taskId, brief, role, deadline? }`.
4. Member **accepts** → starts Run → streams `run.*` to origin; or **refuses** with policy name.

### 6.2 Connect path (simple)

Same order as the phone ([`envoydev-networking.md`](envoydev-networking.md) §5):

1. **LAN / direct** `ws://` if reachable  
2. Else **EnvoyMesh** relay  
3. Optional later: SSH  

UI never asks “LAN or mesh”; the dialer does. Agents never dial — only EnvoyDev ↔ EnvoyDev.

### 6.3 Collect and organize

Origin appends every member’s `run.*` (and handoff / attempt records) into the **job ledger**.
When all tasks are terminal:

- **done** — merge summaries, diffs, and notes into `finalReport`
- **failed** — `finalReport.failures[]` lists every failed task, attempts, and last error
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
  onTaskExhausted: "fail-job" | "continue-partial",  // default fail-job for writer tasks
  onPeerRefuse: "reassign" | "fail-task",            // default reassign if another candidate
  onTeamRevoked: "cancel-job",
}
```

### 7.2 Classification

| Class | Examples | First response |
|---|---|---|
| **Transient** | Timeout, disconnect, heartbeat miss mid-run | Retry **same** member after backoff |
| **Peer offline** | No heartbeat; dial failed | After retries → **reassign** if candidate exists |
| **Policy refuse** | `peer-refused` with named policy | **Do not** blind-retry; reassign or fail-task |
| **Agent failed** | Run `failed` / non-zero logic error | Retry same member up to `maxRetriesPerAssignee` |
| **Writer lock conflict** | Second implement on same `worktreeKey` | Refuse schedule (orchestrator bug if offered) |
| **No candidate** | Role has no online member | Fail-task; if writer or `fail-job` → fail job |
| **Team token expired / rotated** | Join or heartbeat rejected | Member marked offline; in-flight → cancel or reassign |
| **Origin cancel** | Human stop | Cancel offers + runs; job `cancelled` |
| **Partial merge conflict** | Parallel results disagree | Job `merging` → human or orchestrator-agent resolves; else `failed` with both artifacts retained |
| **Stalled / blocked** | Online but no `run.*` for `T_stall`, or approval past `T_approval` | §4.6 critical action (`onStall`); then §7.3 |
| **Stop ignored** | Cancel sent, no ack in `T_cancelAckMs` | `onStopIgnored`: abandon attempt; kick or reassign |

### 7.3 Retry → reassign → fail (per task)

```text
                ┌──────────────┐
                │ Task running │
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
                            reassign        fail task
                            (record)        ──► onTaskExhausted
                                                fail-job | continue-partial
```

**Rules:**

1. Every attempt is appended to `Task.attempts` (memberId, error code, message, at).
2. Reassign increments `reassignCount`; stop at `maxReassigns`.
3. Reassign is **forbidden** when the task is a writer and no other member shares that
   `worktreeKey` / path — fail-task instead (do not invent a second writer elsewhere silently).
4. Policy refuse never burns a retry slot on the same member for the same reason.
5. Cap total wall time per task (`deadline`); on expiry treat as transient then offline path.

### 7.4 Job-level outcomes

| Situation | Job status | Report |
|---|---|---|
| All tasks succeeded | `done` | Full merge |
| Writer task exhausted + `fail-job` | `failed` | Failures + successful siblings retained |
| Non-writer exhausted + `continue-partial` | `done` or `failed` (configurable) | Mark gaps in report |
| Team revoked / token rotated mid-job | `cancelled` | Who was cut off |
| Human cancel | `cancelled` | Partial artifacts kept |

### 7.5 Exception surfaces (wire codes)

Reuse / extend `envoydev.*` rather than inventing silent empties:

| Code | When |
|---|---|
| `envoydev.peer-refused` | Member refuse; `policy` required |
| `envoydev.bad-request` | Illegal schedule (double writer, unknown task) |
| `envoydev.unauthorized` | Bad / expired team token |
| `envoydev.daemon-unreachable` | Dial/heartbeat failure class |
| `envoydev.harness-failed` | Agent run failed after accept |
| (new) `envoydev.team-expired` | Token TTL / rotate |
| (new) `envoydev.task-exhausted` | Retries+reassigns used up |
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
client of origin) may answer. If the assignee goes offline while `needs-attention`, treat as
transient → offline path after timeout (do not leave the job wedged forever).

### 7.8 Stalls and critical stops (detail)

1. Orchestrator evaluates the status board on a timer (e.g. 1s) and on every inbound event.
2. If `blocked: "no-progress"` or `"needs-attention"` past threshold → apply `StallPolicy.onStall`.
3. **Stop run** is always allowed from origin, including when the human presses Stop on the job UI
   for one peer row — not only when automation fires.
4. After stop: prefer clean `run.ended { cancelled }`; if missing, mark attempt `abandoned` and
   free the `worktreeKey` lock so a reassigned writer may proceed.
5. Results already streamed remain in the job ledger (partial credit); the final report names the
   stop reason (`orchestrator-stop`, `stall`, `kick`, …).

---

## 8. Logic review (checklist)

Before implementing a slice, these must hold:

1. **Team before job** — no job without a team; no assign to offline members.
2. **One team token** — copy/paste; rotate to revoke; no QR required.
3. **Orchestrator = origin** — only place that mints tokens, assigns, merges reports.
4. **One writer per worktreeKey** — parallel elsewhere is encouraged.
5. **Retry then reassign then fail** — always recorded; refuse ≠ retry.
6. **Cancel / stop always works from origin** — including remote runs; ignored stop → abandon + kick/reassign.
7. **Status board is authoritative on origin** — stalled peers are visible; critical actions (§4.6) are first-class.
8. **Final report on origin** — peers never “own” the merged outcome.
9. **LAN then mesh** — transport detail, not a user choice.
10. **Node is not the orchestrator** — mesh carries bytes only.

---

## 9. Mapping to what already exists

| Shipped / stubbed | Role in this design |
|---|---|
| `Task.collaboration` + handoffs + `run.handoff` | Local multi-agent rehearsal of assign/handoff |
| `coder.listPeers` / `registerPeer` / `forgetPeer` | Temporary directory until Team join exists |
| `coder.offerParticipantRun` + accept/refuse | Prototype of task offer |
| Phone pairing (QR) | **Different** product: owner’s phone client — not team join |
| Team / Job / team token / retry matrix | **This document — not fully wired yet** |

Implementation order suggestion:

1. **Team + token + heartbeat + join** (copy/paste)  
2. **Job + Task ledger + assign/offer** on top of existing offer RPC  
3. **Parallel scheduler + worktree locks**  
4. **§7 failure machine** (retry/reassign/fail + report)  
5. **LAN dial + mesh fallback** for member channels  
6. Orchestrator-agent assist (`orchestrate` role)

---

## 10. Non-goals

- QR-based team join (PC-hostile); phone pairing QR remains for M4 only  
- One immortal shared token with no TTL/rotate  
- Mesh node as job orchestrator  
- Cloud-hosted agents  
- Unbounded multi-writer on one tree  
- Phone as a peer implementer by default (phone remains client of origin)

---

## Related

* Roadmap M5: [`roadmap.md`](roadmap.md)  
* Networking: [`envoydev-networking.md`](envoydev-networking.md) §5–§6  
* Design decisions: [`envoydev-design.md`](envoydev-design.md) D2/D3 and §7  
