# The daemon's lifetime: with the window, or as a service

**Code:** `apps/desktop/src/daemon`, `apps/desktop/src-tauri/src/main.rs` · **Decision:** app-managed by default; an operating system service only when the owner asks for one.

---

## 1. What is decided

* **By default the daemon is a separate process whose lifetime is the app's.** The Tauri shell starts it, the
  claim file records its pid, and quitting the last window stops it — today's behaviour, unchanged.
* **Service mode is opt-in**, through one setting. It changes *who supervises* the daemon, not what runs: the
  same `main.mjs`, the same home, the same claim, the same protocol. The phone cannot tell the difference
  except that the host is still there when no window is open.
* **The consequence of the default is stated in the UI, not discovered:** while the app is closed, the phone
  cannot reach this machine.

## 2. The facts this rests on

All of these were read from the code, not assumed:

* The shell owns the daemon, and its four lifecycle rules are written down in `src-tauri/src/main.rs:1-32`:
  quitting the app stops *our* daemon by the pid in the claim — **never by port and never by process name** —
  because a stranger on 4770 is not ours. A second window attaches to the daemon already there.
* The claim is the arbitration: `<home>/EnvoyDev/daemon.json` carries `pid`, `port` and `instanceId`, and
  **staleness is a dead pid** — no heartbeat file, no timeout window (`daemon/lock.ts:20-28`). A supervisor
  restart therefore needs no unlock step, which is the single most important enabler here.
* The exit-code policy already exists (`daemon/boot.ts:8-26`): `0` is ours (nothing to do, or a deliberate
  stop), `1` is an unclassified failure, `4` is the family's damaged-profile convention — and **`2` is reserved
  by the family for `exitForNodeSupervisor`, "the signal a supervisor uses to respawn a wedged-but-healthy
  node"**. Reusing `2` for something else would make a supervisor loop on a state no restart can fix.
* The daemon stops cleanly: `SIGINT`/`SIGTERM` → `daemon.stop()` → `exit(0)` (`daemon/main.ts:172-183`).
  Windows has no equivalent signal for an unrelated process (`daemon/main.ts:168-171`).
* Stopping stops the work: `runs.stopAll()` closes each live run's client and waits up to 10s
  (`daemon/runs.ts:995-1006`) — while the comment above the signal handler says it shuts down "without
  disturbing a running agent". One of those two statements is wrong, and service mode makes it matter.
* Memory is bounded by design: finished runs are pruned to 50 (`daemon/runs.ts:1102-1105`), an agent's stderr
  is tailed to 20 lines (`:540`) — but a **live** run's event array grows without a cap (`:1019`).
* Disk is not: transcripts are persisted per task with no rotation or pruning (`daemon/transcript-log.ts`), and
  the shell's `logs/daemon.log` is opened append-only with no rotation (`src-tauri/src/main.rs`,
  `open_daemon_log`).
* There is no health or watchdog machinery today: no `coder.health`, no heartbeat, no last-exit record, and no
  boot-time reconciliation of runs that were live when the daemon died.
* The packages cannot install a service by themselves: the daemon, a Node runtime and Envoy Harness ship as
  bundle **resources** (`scripts/stage-desktop-bundle.mjs:1-13`, `tauri.conf.bundle.json`), the targets are
  `dmg,app` / `nsis` / `deb,appimage` (`scripts/build-dmg.sh:38`, `build-exe.ps1:37`, `build-linux.sh:38`), and
  **macOS and AppImage run no code at install time at all** — a DMG is a drag, an AppImage is a file.
* Service mode is also a standing exposure: the socket binds `0.0.0.0`, token-gated (`docs/roadmap.md`, M1
  note). A daemon that never stops is a port that is never closed.

## 3. The two modes

| | default (with the window) | service mode |
|---|---|---|
| who starts it | the shell, with the first window | the OS supervisor, at login or at boot |
| who stops it | the shell, when the last window quits | the OS, or an explicit stop |
| survives the app quitting | no | yes |
| survives a reboot | no | yes (at boot needs one approval — §5) |
| phone reachable while the app is closed | **no** | yes |

The modes must be distinguishable in the **claim**: `managedBy: "app" | "service"`. Rule 1 of the shell —
"stop the pid I found" — is right for its own daemon and wrong for one a supervisor owns, so the shell stops
only what it manages, and attaches like any other client otherwise. The claim's "one daemon per machine" rule
already covers the interesting case: with a service running, opening the window must **not** start a second
one.

Toggling is a small state machine, and the order is load-bearing: service → off means *stop the service, then
let the app start its own*; off → service means *stop the app's child, then start the service*. A crash in the
middle must not leave both or neither, so the app reconciles at start: unit present but the setting says off →
unload it; setting says on but no unit → install it; a unit owned by another user → report that state rather
than hijacking it.

## 4. The setting is a state, not a boolean

Turning it on is a **request to the operating system** that can fail — an admin prompt declined, no launchd or
systemd, a read-only home, another user's unit. So the setting reports what is *actually* true, not what was
stored:

`off` · `installing` · `on (at login)` · `on (at boot)` · `needs approval` · `failed — <reason>` · `unsupported here`

* It lives on the **desktop only**; the phone may at most read it. A phone must not be able to install or
  remove a host service.
* Adding it means a row in `docs/settings-parity.md` — `npm run settings:check` accounts for every setting —
  and the row must say which side owns it (the daemon performs the change; the window asks for it).
* The copy has to say what the default costs: *"The phone can only connect while EnvoyDev is open."*

## 5. The watchdog, in three layers

They are different problems with different owners, and only the middle one is new code.

| what is wrong | owner | how |
|---|---|---|
| the process died | the **OS supervisor** — no code of ours | launchd `KeepAlive` + `ThrottleInterval`; systemd `Restart=always` + `RestartSec` + `RestartPreventExitStatus=4`; Windows task or service restart-on-failure |
| alive but **wedged** | an **external heartbeat** — a blocked loop cannot restart itself | Linux `WatchdogSec=` + `sd_notify(WATCHDOG=1)` (a datagram write to `$NOTIFY_SOCKET`, no dependency); macOS has no such protocol, so a `StartInterval` probe or a thin wrapper the OS supervises; Windows a scheduled health task or a service wrapper. Plus the family's own door: the daemon may `exit(2)` when it knows it is wedged |
| **work** wedged (an agent silent for an hour, a relay gone) | the daemon, not a watchdog | per-run staleness and timeouts, cancel, reconnect, and visible state |

Three rules keep the watchdog from becoming the outage:

1. **Probe the RPC and the event loop, never run progress.** A long agent turn is normal; a hung event loop is
   not.
2. **Throttle, then give up deliberately.** A crash loop must not hammer: `ThrottleInterval`/`RestartSec`,
   `RestartPreventExitStatus` for `4`, and — for launchd and Windows, which have no equivalent — a restart
   counter the daemon writes; past a threshold it exits `0` and the UI says so rather than looping.
3. **Make restarts visible.** A last-exit record (code, signal, time, version) and a restart count in Settings
   and on the phone: "7×24" is only trustworthy if its interruptions are visible.

## 6. Lifecycle operations

Most of it is **one portable path**; only the parts that must tell the *supervisor* are platform-specific.

| operation | portable | platform adapter |
|---|---|---|
| stop | read the claim, verify `instanceId`, signal that pid — or a loopback `coder.shutdown` where signals do not exist (Windows) | — |
| start / restart | — | launchd `kickstart -k`; systemd `--user restart`; `schtasks /end` + `/run`, or the service manager |
| status | claim + `coder.hello` (instanceId, version) | launchd `print`; systemd `--user status`; `schtasks /query` |
| install / uninstall | — | `bootstrap`/`bootout`; `daemon-reload` + `enable --now`/`disable --now`; `schtasks /create`/`/delete` |
| upgrade | copy a new payload version, flip `current`, restart | the same restart call as above |

`scripts/restart-app.mjs` is the development seed of the portable half — it already stops a daemon by its
claim, in any home the family's rule can choose, and prints the home the app resolves.

**Landed** (`@envoydev/platform`'s `service.ts` and `service-install.ts`, wired by `apps/desktop/src/daemon/supervisor.ts`):
the unit text, the plans and the reading of each supervisor's answer are pure functions tested on whichever OS runs
the suite; only `execFile`/`fs` lives in the daemon. Two things the first *executed* proof changed, and both are now
comments at the code they correct:

* **`launchctl bootout gui/501 <label>` — the domain and the label as two arguments — boots nothing out** and
  answers nothing. The service target (`gui/501/<label>`, one argument) is the form that works; with the wrong one
  the step meant to make install idempotent never ran, and uninstall reported success while leaving the service
  **running**. The unit test had encoded the wrong form; the proof found it by leaving a job behind.
* **An accepted job is not yet a running one.** A status read immediately after `bootstrap` legitimately says
  "installed, stopped", so the install call reports that instant and the caller polls for the rest. Treating that
  instant as failure would show a failure for something that was starting.

The `status` row above stays the *portable* answer where there is one — the claim plus `coder.hello` says which
version is serving, while a supervisor only says whether something is loaded.

## 7. Upgrade

* **Never in place.** The payload is copied to `<home>/EnvoyDev/runtime/<version>` with a `current` pointer,
  and the unit runs `current`. This is not tidiness: on Windows a running `node.exe` locks its own binary, so
  an in-place update cannot work at all.
* The unit only has to be rewritten when the *unit* changes (new flags, new paths); a code update is a flip
  plus a restart.
* **Drain before restarting.** A restart ends live runs — `stopAll` closes their clients. Either wait for
  idle, or ask; never cut a run silently.
* Reconcile on boot: a run that was live when the daemon died is marked interrupted, and its transcript (which
  survives) is what the user reads. Nothing does this today.
* The trigger already exists: `coder.hello` carries the daemon's version, and the client already refuses an
  old daemon (`error.daemonTooOld`).
* Keep N−1 payloads for rollback, and prune only after a restart — never delete the version a live daemon is
  running from.

## 8. Uninstall

Stop the service, remove the unit, then the payload. Keep the user's state (projects, tasks, transcripts,
pairing) unless they ask for it to go. macOS is the awkward one: deleting the app from Applications runs **no
code**, so a CLI is mandatory (`…/runtime/current/main.mjs service uninstall`), alongside the Settings control;
NSIS and the deb can call the same path. Because the unit points at `current`, a partially removed install
fails visibly (and throttled) rather than silently.

## 9. What must exist before any of this is honest

A checklist, in build order:

1. ~~the claim's `managedBy`, and the shell attaching instead of killing (§3)~~ **landed**: the daemon writes
   `managedBy` (from `--managed-by`, default `app`) and the shell stops the claim's pid only when the claim is
   `app` — while still reaping a child it spawned itself;
2. ~~the payload copy under the runtime directory, versioned (§7)~~ **landed**: `daemon/payload.ts` installs
   `runtime/<version>/` (copy into a temporary directory, rename into place, `current` as a *file* so no symlink
   privilege is needed on Windows), refuses to rewrite an installed version, and prunes everything the caller
   does not protect — with `--install-payload` as the entry point the app or a service install runs;
3. ~~`coder.health` — uptime, pid, version, active runs, event-loop lag, heap~~ **landed** (`daemon/health.ts`;
   last-event age comes with the heartbeat below, because a per-event stamp belongs with the recorder);
4. the heartbeat, the last-exit record, and log rotation — **landed, with one sliver owed**:
   * `coder.health`'s `runs.lastEventAt` and a restart ledger (`daemon/lifecycle.ts`) recording every start plus
     every deliberate stop, printed at boot, so a crash loop cannot hide. A boot is recorded only when the process
     actually **serves** — a launch that finds another daemon already running is not a restart, which a real-boot
     check caught after reading had missed it;
   * the heartbeat is a **file** (`logs/heartbeat.json`, states `ready`/`beating`/`stopping`) whose *age* is the
     signal, because Node cannot speak systemd's datagram at all: `node:dgram` is UDP-only and answers
     `unix_dgram` with "Bad socket type specified. Valid types are: udp4, udp6" (measured). A unit wanting
     systemd's own `WatchdogSec` needs `systemd-notify` (it ships with systemd) or `ExecStartPost`; the file is
     what every platform's probe reads, which is the option launchd and Windows have anyway;
   * `daemon.log` is rotated at 5 MB with one previous file, before the append;
   * ~~the exit *code* on a controlled failure~~ **landed**: a refused boot and a failure the process understood
     are recorded as deliberate stops *with their code* (`recordStop({ signal: "refused", exitCode })`), and the
     next boot prints it — "exited 4" rather than "did not stop on purpose (no stop record)". The code is kept by
     the parser only when it is a whole number: a value that merely claims to be an exit code is worse than none;
5. ~~bounds on the live run-event buffer and on transcripts~~ **landed**: the in-memory buffer keeps the newest
   2 000 events of a run and drops from the front, so a client whose `sinceSeq` fell out of the window sees a *gap
   in the sequence numbers* rather than silent loss — the transcript is the record, this is only a catch-up
   window. One run's transcript stops growing at 8 MB, keeps the beginning (which is what a person reads) and says
   so once on stderr; both bounds are injectable, because a test that must cross 2 000 events or 8 MB is not a
   test anybody runs. `recall()` loads a transcript through the same window;
6. ~~boot-time run reconciliation~~ **landed**: `daemon/reconcile.ts` runs after the store opens and before the
   first client can connect, and it distinguishes the three cases reading is prone to confuse — a run whose
   transcript recorded an ending is carried forward *as that ending*, a run that never ended is failed and
   reported in the boot log as stranded, and `needs-attention` is left completely alone (it is active for the
   sidebar, but its run has ended and a person still owes it an answer);
7. ~~drain-on-restart~~ **landed**: the stop asks live runs to stop and waits up to ten seconds for them
   (`runs.stopAll`), and the boot report's old claim about "leaving a running agent alone" is corrected — what is
   true is that a *supervisor-owned* daemon is not stopped when the window closes (§3). A test drives a live run
   through `stopAll` and asserts it ends rather than staying live for ever;
8. ~~a portable graceful stop for Windows~~ **landed, with the shell's half owed**: `coder.shutdown` is on the
   wire — answered *before* the drain begins, owner-window-only (a lost phone must not be able to end the
   desktop's daemon), and it records why the process stopped. It is the only stop Windows has, because there is
   no signal an unrelated process can send; the remaining half is the Tauri shell calling it before it resorts to
   `taskkill`;
9. ~~the service module with per-platform unit text as a pure function in `@envoydev/platform`~~ **landed**:
   `service.ts` writes the launchd plist, the systemd user unit and the Task Scheduler definition — at login and
   not at boot, restarting on failure and never on a deliberate stop (`SuccessfulExit=false`,
   `RestartPreventExitStatus=0 4`), carrying `--managed-by service` and `--home <path>`; `service-install.ts`
   holds the plans, the parsers and the four operations with their I/O injected, so Linux's and Windows' branches
   are tested on this machine; `supervisor.ts` supplies the *installed* payload's paths, the log path and the real
   `execFile`/`fs`. `npm run service:proof` installs a genuine launchd agent from a **temporary** user home (never
   the owner's `~/Library/LaunchAgents`), proves the daemon's claim reads `managedBy=service`, kills the daemon to
   watch `KeepAlive` restore it, and boots the job out in a `finally` whatever happens. **Owed still:** a CLI
   entry point (`…/runtime/current/main.mjs service …`, which §8 needs on macOS, where deleting the app runs no
   code) and the Settings control — item 10. Linux and Windows stay unit-text and plan tests plus the owner's
   checks: nothing here can execute systemd or the Task Scheduler;
10. the Settings page (states, restart count, log tail, stop/restart/uninstall) and one row in
    `docs/settings-parity.md`.

## 10. What this does not decide yet

* **Multi-user machines — assumed away, by decision.** This design assumes **one user per machine**: the
  service belongs to the account that installed it, and a second account's window is expected to report the
  daemon as owned elsewhere rather than hijack it. (That reporting behaviour is still to build; the *question*
  is closed so the service layout can be.)
* **Whether the phone may read service state** (this document assumes yes for reading, no for changing).
* **Whether EnvoyMesh's supervisor is reused verbatim.** The family reserved exit `2` for
  `exitForNodeSupervisor`; the family rule is to reuse that implementation rather than to write a second one,
  so the slice must find and read it first.
* **The "before anyone logs in" approval:** a LaunchDaemon needs admin on macOS, Windows needs stored
  credentials or a service account, Linux needs `enable-linger`. The UX for that one prompt is not designed
  here.
* **Whether service mode narrows the socket bind** while the machine is unattended.
* **Whether uninstall removes user state** or only the service and payload.
