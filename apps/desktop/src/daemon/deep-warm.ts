/**
 * **The deep facts, arriving without anybody pressing anything.**
 *
 * ## The problem this file solves, in the owner's words
 *
 * *"I don't want user to guess, to check if we can do that."* The cheap facts — is the program here, is its
 * connector here, is it fetched on first run, are the variables the launch needs set — are resolved for every
 * row before the list is served, so a verdict needs no press. But three facts cannot be answered that way and
 * never will be: **whether an agent speaks ACP, what it publishes (models, modes, thinking levels) and whether
 * it wants a sign-in** are all learned by *starting* it. That is a process spawn, a handshake and a timeout,
 * and for the catalyst's `npx -y …` recipes it is a package download.
 *
 * So the mandate's rule for those facts is that they are not a row state at all: they run *"when the intent
 * exists (on Add, on running a task, or in the background, throttled one at a time, for real binaries that are
 * Ready)"*, they are cached, and they appear as **properties with the time** (`Verified 4 minutes ago`). What
 * this module adds is the third trigger — the background one — because the other two already existed and both
 * of them require a user to have done something first: `SessionProbe` answers `coder.probeSessionOptions` (a
 * press) and `RunManager` records what a session published when a task actually runs.
 *
 * ## The four bounds, and the one rule
 *
 * A daemon that starts agents behind the user's back is a daemon that can do real harm, so this is not a
 * loop that walks a list. It is four explicit bounds and one prohibition:
 *
 * | bound | why |
 * |---|---|
 * | **One at a time, in sequence, with a gap** | two agents starting together is two processes, two handshakes and two timeouts' worth of CPU on a machine somebody is working on |
 * | **Only `ready` rows** | nothing else can be started at all — a `not-installed` row has no program, and `needs-bridge`/`unsupported` have nothing this build can drive. Starting one would be a failure dressed as a measurement |
 * | **Never a program fetched on first run** | the prohibition, and the reason `WarmCandidate.fetchedOnFirstRun` exists: an `npx -y <pkg>` recipe would **download a package** because a user opened an app. Nothing in the background path is ever allowed to spend a user's network |
 * | **One pass per boot, and `SessionProbe`'s own cache decides the rest** | an agent observed recently (within `PROBE_STALE_MS`, on the same build) is answered from the cache, so a second boot costs a `stat` per agent rather than a session |
 *
 * The gap is `WARM_GAP_MS` and the whole pass stops when `stop()` is called — a daemon shutting down must not
 * leave an agent behind, which is the property `agent-teardown.ts` was written for one layer down.
 *
 * ## Off by default, and on in the one place it is right
 *
 * `startCoderDaemon` takes `warm: true` and defaults it to **false**: the production entry point
 * (`daemon/main.ts`) opts in, and every test and `scripts/smoke.ts` stays out. That is not timidity — a suite
 * that spawns the developer's own coding agents on every run is a suite that makes a machine unusable, and the
 * "does loading the page spawn anything" property this slice has to prove would be unprovable if the daemon
 * warmed by default.
 */

import type { HarnessAvailability, HarnessId } from "@envoycoder/protocol";

/**
 * How long the warmer waits between two agents.
 *
 * Long enough that the machine is never doing two of these at once even at the edges (a session that times
 * out takes up to `PROBE_TIMEOUT_MS`), short enough that a fresh install's facts are on screen within a
 * couple of minutes. It is a bound on *politeness*, not on correctness: nothing depends on the pass finishing.
 */
export const WARM_GAP_MS = 3_000;

/**
 * How long a **stored** observation keeps a background pass from asking again.
 *
 * The in-memory cache (`SessionProbe`'s, ten minutes) is what makes a second pass in one session free. This is
 * the bound across *sessions*, and it is here because a daemon is started far more often than an agent's
 * published surface changes: without it, launching the app would start nine agents every time, and a person
 * who opens and closes EnvoyCoder a dozen times a day would pay for that a dozen times over.
 *
 * Six hours is chosen against what the facts *are*: the models and modes an agent publishes change when the
 * agent is upgraded, and the sign-in requirement changes when a credential expires — neither is a
 * minute-to-minute fact, and both are re-checked the moment a run actually happens (which records its own
 * observation) or when a user presses *Ask again* on the composer. So this bound can delay a fact by hours and
 * cannot make a wrong one right — and the row says *when* it was verified rather than implying it is current.
 */
export const WARM_STALE_MS = 6 * 60 * 60_000;

/** One agent the warmer may consider. */
export interface WarmCandidate {
  id: HarnessId;
  /** What this daemon measured on the cheap path — the same value the row's verdict came from. */
  availability: HarnessAvailability;
  /**
   * True when this daemon already holds an observation about this agent from inside `WARM_STALE_MS`.
   *
   * Read from the **store** rather than from `SessionProbe`'s cache, deliberately: the store survives a
   * restart and the cache does not, so this is the field that makes a second launch of the app cost nothing.
   */
  observedRecently: boolean;
  /**
   * True when starting this program would **fetch** it first — the catalogue's `npx -y <pkg> …` shape.
   *
   * Derived from the catalogue rather than passed as a constant, and it is the only field here that is a
   * prohibition rather than a preference: the background path may never download anything on a user's behalf.
   * See `warmCandidates` for where the daemon gets it.
   */
  fetchedOnFirstRun: boolean;
}

/**
 * **Who is worth a look, in the order to look at them** — the whole decision, as a pure function.
 *
 * Sorted by id so two boots ask in the same order (a machine that is shut down before the pass finishes makes
 * progress across boots rather than re-asking about whichever agent sorts first), and filtered by the two
 * bounds above. Exported and tested on its own because it is the part that could quietly be wrong in the
 * direction that costs a user money.
 */
export function warmPlan(candidates: readonly WarmCandidate[]): HarnessId[] {
  return candidates
    .filter((candidate) => candidate.availability.state === "ready")
    .filter((candidate) => !candidate.fetchedOnFirstRun)
    // The cross-session bound: an agent we already have a recent observation about is not asked about again.
    // It is a *filter* rather than a mark-and-continue so that a machine where everything has been observed
    // costs nothing at all — no spawn, not even a short-lived one.
    .filter((candidate) => !candidate.observedRecently)
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
}

/** What one pass did, for the log and for a test that has to see the bound hold. */
export interface WarmReport {
  /** The agents a pass considered, in order. */
  planned: readonly HarnessId[];
  /** The agents it actually asked about, in order — one at a time, never two. */
  asked: readonly HarnessId[];
}

export interface DeepWarmDeps {
  /** The agents to consider, re-read at the start of each pass so a provider added a moment ago is included. */
  candidates: () => readonly WarmCandidate[];
  /**
   * Ask one agent what it offers.
   *
   * `SessionProbe.probe` is the production implementation, and it is the reason this module needs no cache of
   * its own: a fresh observation on the same build is returned without spawning anything, so "ask" here means
   * "ask, or learn that we already know".
   */
  ask: (id: HarnessId) => Promise<unknown>;
  /** Something changed that a window should re-read. Called at most once per agent that answered. */
  onAnswer?: (id: HarnessId) => void;
  /** The gap between two agents. Injected so a test does not wait 3 seconds per agent. */
  gapMs?: number;
  /** Injectable sleep, on the same terms as `gapMs`. */
  sleep?: (ms: number) => Promise<void>;
  /** One line per pass, for the daemon's stderr. A failure is a log line and never a crash. */
  note?: (line: string) => void;
}

/** A running pass, and the way to stop it. */
export interface DeepWarm {
  /** Wait for the current pass, if one is running. Never rejects. */
  done(): Promise<WarmReport>;
  /** Stop after the agent in flight. The pass does not start another. */
  stop(): void;
}

/**
 * Start one pass, in the background, and return the handle.
 *
 * Never rejects and never throws: every failure mode here is either "nothing to do" or "this agent did not
 * answer", and both are already the outcome `SessionProbe.probe` reports as data. A daemon that failed to boot
 * because a background courtesy could not reach an agent would be a strictly worse product than one that did
 * not try.
 */
export function startDeepWarm(deps: DeepWarmDeps): DeepWarm {
  const gapMs = deps.gapMs ?? WARM_GAP_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let stopped = false;

  const pass = (async (): Promise<WarmReport> => {
    const planned = warmPlan(deps.candidates());
    const asked: HarnessId[] = [];
    for (const [index, id] of planned.entries()) {
      if (stopped) break;
      // The gap comes *before* the second and later agents, so a pass with one agent to ask starts at once —
      // the delay is a courtesy to the machine, not a warm-up ritual.
      if (index > 0) await sleep(gapMs);
      if (stopped) break;
      try {
        await deps.ask(id);
        asked.push(id);
        deps.onAnswer?.(id);
      } catch {
        // `probe` reports its failures as outcomes rather than by throwing, so reaching here means something
        // quite unexpected. It is still not the daemon's problem: the row keeps the verdict it already had.
      }
    }
    if (planned.length > 0) {
      deps.note?.(
        `[envoycoder] looked at what ${asked.length} of ${planned.length} agent` +
          `${planned.length === 1 ? "" : "s"} publish, in the background and one at a time\n`,
      );
    }
    return { planned, asked };
  })();

  return {
    done: () => pass.catch(() => ({ planned: [], asked: [] })),
    stop: () => {
      stopped = true;
    },
  };
}
