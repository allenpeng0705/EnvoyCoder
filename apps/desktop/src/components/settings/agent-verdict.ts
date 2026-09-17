/**
 * **One verdict per row, and the way out of it** — the projection from what the daemon measured to the two
 * words a user reads, as a pure function so the part that can silently mislead is testable without a DOM.
 *
 * ## The mandate, and the five states it replaced
 *
 * The owner's words: *"I don't want user to guess, to check if we can do that. And If the agent cannot be used
 * - 'Not Ready', we should clearly know what the problem is and guide user to resolve it if he want to use this
 * coding agent."* Plus the vocabulary from the two messages before that: **one verdict per row — Ready / Not
 * ready**, with the one exception of the one row action a user has to take (`Sign in`); caveats are
 * *properties*, not chips; and **"Not checked" must essentially disappear**, because the product must not ask
 * a user to press something in order to learn a state.
 *
 * What this replaced was five wire states rendered as five chips — `Ready`, `Not downloaded yet`,
 * `Cannot be driven yet`, `Needs its adapter`, `Not installed`, `Could not check` — under which the *only*
 * thing a user actually needs to decide ("can I use this coding agent here, and if not what do I do") had to
 * be reassembled from a chip and a loose command line. Two states are also what the reference product's
 * provider list states per row, and its catalogue row offers one next step rather than a status vocabulary.
 *
 * So the wire keeps its five states — they are **evidence**, and each one is a different fact with a
 * different paragraph behind it — and this file is the single place that turns them into a verdict. Nothing
 * downstream branches on `HarnessState`; a caller reads `verdict`, `line` and `guide`.
 *
 * ## The five Not-ready cases, and the fifth one that is not one
 *
 * The mandate enumerates five things a Not-ready row can be about, and the fifth is a case only in the sense
 * that it must **not** be treated as one:
 *
 * | case | what the row says | what the detail leads with |
 * |---|---|---|
 * | `connector` | *Installed — its connector is missing* + the command | **what is present first** — *"{agent} is installed. EnvoyDev needs its connector to drive it:"* — then the exact `npm install -g …` |
 * | `absent` | the first install step, verbatim | the entry's install steps **in the order to run them**, and its own link |
 * | `env` | *"{NAME} is not set"* | the variable's name(s) and where the value comes from — which is always the user |
 * | `our-gap` | *EnvoyDev cannot drive this agent yet* | that this is **our** gap and there is nothing to install |
 * | `unlooked` | *EnvoyDev could not check this machine* | that this is our gap too, and the one action that re-measures (`Restart EnvoyDev`) |
 * | **`npx`** | **not a Not-ready case at all** | an `npx -y …` recipe is fetched on the first run, so it is **Ready** and the row says so |
 *
 * The `connector` case is the one that produced the report this slice exists for — *"Some agents I have
 * installed, but still show need to install or need adapter. Eg, codex, claudecode, deepseek-harness."* Two of
 * those three were measured correctly and read wrongly: `codex-acp` and `claude-agent-acp` genuinely are not
 * installed, so `needs-bridge` is the right state — and a row whose only sentence was an install command tells
 * a reader "nothing here is installed" about a CLI they use every day. Hence **the lead names what is
 * present**, and the absence is named by the chip beside it.
 *
 * ## `our-gap` is not an install problem, and the layout says so
 *
 * The distinction the mandate asks for — *"Distinguish 'there is a fix' from 'there is nothing you can do',
 * in the words and in the layout"* — is `guide.kind`. `steps` and `environment` are things to do; `nothing`
 * is not, and the component renders **no list, no command and no link** for it rather than a sentence that
 * happens to be short. An `unsupported` entry has an `installLink` on it (the vendor's page, which is true and
 * useful for *reading*), and rendering that link under "we cannot drive this yet" is exactly the failure the
 * mandate forbids: dressing our gap as their missing install.
 *
 * ## What is deliberately not here
 *
 * Whether an agent **speaks ACP**, what it publishes and whether it wants a sign-in cannot be known without
 * starting it, and fourteen of the catalogue's recipes would download a package to be started. So none of
 * that is a verdict: those facts travel as **properties with the time EnvoyDev observed them**
 * (`verdictFacts`), they are recorded when a session happens, and no row ever reads "not checked" as its
 * state. See `docs/settings-parity.md` §7.17.
 */

import type {
  AgentDelivery,
  AgentProviderSummary,
  HarnessAvailability,
  HarnessSummary,
} from "@envoydev/protocol";

// The one rule about labels, kept where it was: a value **we** wrote carries a catalogue key and is
// translated, and a value the **agent** wrote is shown as the agent wrote it — a model label has no key in
// the protocol at all. These two helpers are that rule, and the composer already used them.
import { modeLabel, optionLabel } from "../../composer/controls.js";
import type { Locale } from "../../i18n/locales.js";
import type { MessageKey } from "../../i18n/messages/en.js";
import { formatAgo, formatWhen } from "../../i18n/when.js";

/** The translator, as `i18n/context.ts` hands it out. Narrowed to what this module needs. */
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * **The two verdicts.** A union rather than a string, so a third one cannot be added by a typo, and the
 * closed table below cannot fall behind it.
 */
export type Verdict = "ready" | "not-ready";

/** Why a row is not ready. See the table in the module doc; `npx` is deliberately absent. */
export type NotReadyReason = "connector" | "absent" | "env" | "our-gap" | "unlooked";

/**
 * **The chip's two possible values, and there are exactly two.**
 *
 * A closed table keyed by the verdict, so "one chip per row" is a property of the types rather than a habit:
 * a caller that wants a caveat on a row has nowhere to put it, because a caveat is a property
 * (`verdictFacts`) and the row's only chip is the verdict. `settings-agent-verdict.test.tsx` asserts the
 * count on every row of every list, and `docs/settings-parity.md` §7.17 records why the caveat chips were
 * removed rather than recoloured.
 */
export const VERDICT_CHIP = {
  ready: { key: "settings.agent.verdict.ready", className: "chip--live" },
  "not-ready": { key: "settings.agent.verdict.notReady", className: "chip--danger" },
} as const satisfies Record<Verdict, { key: MessageKey; className: string }>;

/**
 * **What a picker may say beside an agent's name — the same two words the Agents page uses, and nothing else.**
 *
 * Both pickers (the machine's default agent, a project's) used to append *"(needs installing)"* whenever the
 * recipe was `tier: "catalogued"`. That is a fact about where a recipe came from rendered as a fact about the
 * user's machine, and it was wrong the moment the programme was installed: the owner's report — *"the dropdown has
 * some agents, but the status is wrong"* — is a catalogued agent that is **ready** reading *needs installing*.
 *
 * So the suffix **is the verdict** — computed by the same `rowVerdict` the page's rows use, in the words of the same
 * `VERDICT_CHIP` table — and the picker and the page cannot drift, because there is one decision and one table.
 * `""` for a ready agent: a picker that labels every row is a picker whose labels stop being read.
 */
export function verdictSuffix(availability: HarnessAvailability | undefined, t: Translate): string {
  const ready = rowVerdict(
    {
      label: "",
      availability,
      // Neither is needed for the verdict itself, and `rowVerdict` is where the decision lives: an agent we could
      // not look at is **Not ready** here exactly as it is on the page, because "we have not looked" is not a
      // reason to promise a run.
      readyLine: "",
    },
    t,
    0,
  ).verdict;
  return ready === "ready" ? "" : ` — ${t(VERDICT_CHIP["not-ready"].key)}`;
}

/**
 * What the disclosure leads with — **the fix, or the plain statement that there is none.**
 *
 * Four kinds and not two, because "there is something to do" has three genuinely different shapes (run these
 * commands; set these variables; restart the app) and collapsing them into one would put an install list
 * under a daemon that is merely a build behind. `nothing` is the fourth: our gap, no action, and the
 * component renders nothing under it.
 */
export interface VerdictGuide {
  kind: "steps" | "environment" | "app" | "nothing";
  /** The sentence the detail leads with. */
  lead: string;
  /** Commands, in the order to run them. Empty for every kind but `steps`. */
  steps: readonly { command: string; url?: string }[];
  /** Filesystem or environment names, for `environment`. Empty otherwise, so a caller never indexes it. */
  names: readonly string[];
  /**
   * A page to read more — the vendor's own install page, and **offered only where there is an install to
   * do**. Absent for `nothing` and `our-gap`, which is the layout half of "our gap is not your install".
   */
  href?: string;
  /**
   * An instruction that is not a command line, for the one kind that has one: *Restart EnvoyDev*.
   *
   * A separate field from `href` rather than a URL-shaped string in the same slot, because reusing one field
   * for two kinds of thing is how a renderer ends up putting an `href` on a sentence — and this file exists
   * to stop exactly that class of mistake one step earlier.
   */
  action?: string;
}

/** One row's verdict, its one line, and what opening it offers. */
export interface RowVerdict {
  verdict: Verdict;
  /** The chip's key — one of the two in `VERDICT_CHIP`. */
  chipKey: MessageKey;
  /** The chip's class. */
  chipClass: string;
  /** The row's single line. ≤ `AGENT_ROW_LINE_BUDGET`, or the caller's fallback phrase. */
  line: string;
  /** A command that shares the line, set in its own face. Never the whole line when the line is a sentence. */
  command?: string;
  /** True when the line *is* a command, so the whole line is monospaced. */
  lineIsCommand: boolean;
  /** The whole of what the line abbreviates, when it abbreviates anything. */
  lineTitle?: string;
  /** Why, when it is not ready. `undefined` for a ready row — the two never coexist. */
  reason?: NotReadyReason;
  /** What the detail leads with. Absent for a ready row: there is nothing to resolve. */
  guide?: VerdictGuide;
}

/** What the caller knows about the row. Every field is either measured by the daemon or the row's own text. */
export interface VerdictInput {
  /** What a user calls it — the name on the row, and the word inside a lead sentence. */
  label: string;
  /**
   * What the daemon measured. `undefined` is a daemon from an **older build** that does not send the field at
   * all, which is a real state on this wire (§7.2) and is rendered as our gap rather than as a verdict about
   * somebody's program.
   */
  availability: HarnessAvailability | undefined;
  /** How the program is obtained, when the row knows. An `npx` recipe needs no install at all. */
  install?: { kind: "npx"; package: string } | { kind: "binary"; binary: string };
  /**
   * Variables this row's launch needs that this daemon does not have — a user's own provider names them.
   *
   * Only ever non-empty for a program the user declared: a catalogue recipe's own constants are supplied by
   * the daemon (`AgentProviderEnvState.from === "catalogue"`), so they can never be the reason a row is not
   * ready, and a row that claimed so would send a user to export something EnvoyDev already provides.
   */
  missingEnv?: readonly string[];
  /** Where a user gets this program, when the row names a page. Offered only when there is an install to do. */
  installLink?: string;
  /** What the row says when nothing needs fixing: the tier, or the command line it would run. */
  readyLine: string;
  /** Everything that must share the line with `readyLine`, for the budget arithmetic — the row's own choice. */
  readyLineIsCommand?: boolean;
}

/**
 * How many characters a line may carry — **passed in rather than imported**, and the reason is that this
 * module must not be the second declaration of a budget `density.ts` owns.
 *
 * The one caller that has a budget (`density.ts`'s `AGENT_ROW_LINE_BUDGET`) passes it; a test passes a small
 * number to drive the fallback branch from both sides. Defaulting to the real budget would make the default
 * the second declaration this avoids, so there is no default.
 */

/**
 * The verdict, the line and the guide for one row.
 *
 * ## The order the facts are read, and why it is not the wire's order
 *
 * The wire's states are already ordered by *what is missing* (`probe.ts` documents the order as the whole
 * fix for the original "all of them show Not Installed" report). This function re-reads them in the order a
 * **user** needs, which differs in exactly one place: a program that is present but whose environment is
 * incomplete is `ready` on the wire and **Not ready** here, because a user who presses Run and gets a
 * credential error was told Ready by this product a moment earlier.
 *
 * ## The one thing this function may never do
 *
 * It may never turn our own ignorance into a claim about somebody's machine. `unknown` and a missing
 * `availability` both become `our-gap`/`unlooked` — never `absent`, whose whole sentence is "there is no such
 * program here" — and neither ever carries a `steps` guide, so no install command is offered for something we
 * did not establish was missing.
 */
export function rowVerdict(input: VerdictInput, t: Translate, budget: number): RowVerdict {
  const availability = input.availability;

  if (availability === undefined) {
    // A daemon from an older build: it does not answer this question at all, so the row says *that* rather
    // than blaming the machine. The action is the one that fixes a build skew, and it is not an install.
    return notReady("unlooked", {
      line: t("settings.agent.verdict.legacy.line"),
      guide: {
        kind: "app",
        lead: t("settings.agent.verdict.legacy.why", { agent: input.label }),
        steps: [],
        names: [],
        action: t("settings.agent.verdict.app.restart"),
      },
    });
  }

  switch (availability.state) {
    case "ready": {
      // **The one verdict that can still be Not ready**, and the reason is the sentence a user would
      // otherwise get two minutes later: the program is here and the daemon cannot start it, because a
      // variable the launch needs is missing. See the module doc.
      const missing = input.missingEnv ?? [];
      if (missing.length > 0) return missingEnvironment(input, missing, t);
      return ready(input);
    }
    case "needs-bridge":
      return connector(input, availability, t, budget);
    case "not-installed":
      return absent(input, availability, t, budget);
    case "unsupported":
      // **Our gap, in our words.** No steps, no link, no install command: an `unsupported` entry has an
      // `installLink` on it and rendering that here would dress our missing adapter as their missing program.
      return notReady("our-gap", {
        line: t("settings.agent.verdict.gap.line"),
        guide: {
          kind: "nothing",
          lead: t("settings.agent.verdict.gap.why", { agent: input.label }),
          steps: [],
          names: [],
        },
      });
    case "unknown":
      return notReady("unlooked", {
        line: t("settings.agent.verdict.unlooked.line"),
        guide: {
          kind: "app",
          lead: t("settings.agent.verdict.unlooked.why", { agent: input.label }),
          steps: [],
          names: [],
          action: t("settings.agent.verdict.app.restart"),
        },
      });
  }
}

/* ────────────────────────────── the four Not-ready branches ────────────────────────────── */

/**
 * **The reported bug, fixed in the words rather than in the measurement.**
 *
 * `needs-bridge` means the agent's own program resolved and the adapter we drive did not. The row therefore
 * leads with the presence (`Installed — its connector is missing`) and carries the adapter's install command
 * on the same line, in its own monospaced face, so a reader meets "you have this" before "install this".
 *
 * The fallback is real and reachable, and it **keeps the phrase**: when the lead and the command cannot share
 * `AGENT_ROW_LINE_BUDGET`, the command moves to the `title` and to the disclosure and `Installed — needs its
 * connector` stays on the line. The first draft dropped to a shorter phrase there, which is the same defect
 * wearing the other hat — the half a user needs first is *Installed* — so there is one string and two branches
 * rather than two strings. `settings-agent-row.test.tsx` drives both, and §7.17.2 records why.
 */
function connector(
  input: VerdictInput,
  availability: HarnessAvailability,
  t: Translate,
  budget: number,
): RowVerdict {
  const steps = availability.fix ?? [];
  const first = steps[0]?.command;
  /**
   * **The line names what is present and what is missing, in one phrase, and it is the same phrase whether or
   * not the command fits beside it.**
   *
   * There is deliberately no second, shorter string for the fallback. The first draft had one — the budget
   * branch dropped to *"Needs its connector"* — and that is exactly the defect this case exists to fix
   * wearing the other hat: the half of the sentence a user needs first is *"Installed"*, and a fallback which
   * drops it because the command is long tells a user with Codex installed that they need to install
   * something. So when the command does not fit, the phrase stays and the command moves to the `title` and the
   * disclosure — which is what the budget branch is for.
   */
  const line = t("settings.agent.verdict.connector.lead");
  const whole = steps.map((step) => step.command).join("\n");
  // `fits` is computed from a *value* rather than from the array, so the narrowing is real and there is no
  // non-null assertion waiting to be wrong on a wire that broke `HarnessAvailabilitySchema`'s own rule.
  const fits = first !== undefined && `${line} ${first}`.length <= budget;
  return notReady("connector", {
    // The presence first, named by the chip as the one missing piece.
    ...(fits
      ? { line, command: first, ...(whole === first ? {} : { lineTitle: whole }) }
      : { line, ...(whole === "" ? {} : { lineTitle: whole }) }),
    guide: {
      kind: "steps",
      lead: t("settings.agent.verdict.connector.why", { agent: input.label }),
      steps,
      names: [],
      ...(input.installLink !== undefined ? { href: input.installLink } : {}),
    },
  });
}

/**
 * Nothing resolved, over a search that actually ran — the one state whose sentence is "there is no such
 * program here", and the only one allowed to lead with an install command.
 *
 * The row's line is the **first step verbatim** when it is a command that fits, because that is what a user
 * copies; when the entry's hint is a sentence (the catalogue's own `install Node.js so that \`npx\` is on
 * PATH — …` is 127 characters), the line is the short phrase and the whole of it goes to the `title` and to
 * the disclosure, which is `fixOrPhrase`'s rule kept as it was.
 */
function absent(
  input: VerdictInput,
  availability: HarnessAvailability,
  t: Translate,
  budget: number,
): RowVerdict {
  const steps = availability.fix ?? [];
  const first = steps[0]?.command;
  const whole = steps.map((step) => step.command).join("\n");
  const fits = first !== undefined && first.length <= budget;
  return notReady("absent", {
    ...(first !== undefined && fits
      ? { line: first, lineIsCommand: true, ...(whole === first ? {} : { lineTitle: whole }) }
      : {
          line: t("settings.agent.verdict.absent.short"),
          ...(whole === "" ? {} : { lineTitle: whole }),
        }),
    guide: {
      kind: "steps",
      lead: t("settings.agent.verdict.absent.why", { agent: input.label }),
      steps,
      names: [],
      ...(input.installLink !== undefined ? { href: input.installLink } : {}),
    },
  });
}

/**
 * The program is here and the daemon cannot start it, because a variable its launch names is not set.
 *
 * This case exists because of what "Ready" would otherwise promise. A user's own provider names
 * `ANTHROPIC_API_KEY`, the program resolves, and the old row said Ready and a chip somewhere said the
 * variable was unset under a disclosure — two facts a user has to join themselves, in the one situation where
 * pressing Run produces a failure that looks like a bug. The **name** is the row's line and the *where it comes
 * from* is the guide's second sentence, which is the mandate's own instruction: *"name it and say where the
 * value comes from"*.
 */
function missingEnvironment(input: VerdictInput, missing: readonly string[], t: Translate): RowVerdict {
  const names = missing.join(", ");
  const first = missing[0] ?? "";
  return notReady("env", {
    line:
      missing.length > 1
        ? t("settings.agent.verdict.env.line.more", { name: first, count: missing.length - 1 })
        : t("settings.agent.verdict.env.line", { name: first }),
    lineTitle: names,
    guide: {
      kind: "environment",
      lead: t("settings.agent.verdict.env.why", { agent: input.label, names }),
      steps: [],
      names: missing,
      // Deliberately no link: a vendor's download page does not hold the user's key, and offering one here
      // would be the same mistake as offering an install for something that is already installed.
    },
  });
}

/** A row with nothing to fix: the caller's own phrase, and no guide at all. */
function ready(input: VerdictInput): RowVerdict {
  return {
    verdict: "ready",
    chipKey: VERDICT_CHIP.ready.key,
    chipClass: VERDICT_CHIP.ready.className,
    line: input.readyLine,
    lineIsCommand: input.readyLineIsCommand === true,
  };
}

/** The assembler for the four Not-ready branches, so the chip can never disagree with the verdict. */
function notReady(
  reason: NotReadyReason,
  rest: Pick<RowVerdict, "line" | "guide"> & Partial<Pick<RowVerdict, "command" | "lineIsCommand" | "lineTitle">>,
): RowVerdict {
  return {
    verdict: "not-ready",
    chipKey: VERDICT_CHIP["not-ready"].key,
    chipClass: VERDICT_CHIP["not-ready"].className,
    reason,
    line: rest.line,
    lineIsCommand: rest.lineIsCommand === true,
    ...(rest.command !== undefined ? { command: rest.command } : {}),
    ...(rest.lineTitle !== undefined ? { lineTitle: rest.lineTitle } : {}),
    ...(rest.guide !== undefined ? { guide: rest.guide } : {}),
  };
}

/* ────────────────────────────── the properties ────────────────────────────── */

/** One plain fact about a row: a label, and the row's own value for it. */
export interface RowFact {
  label: string;
  value: string;
  /** True when the fact is a caveat a user should notice — it is a *value*, not a chip. */
  caveat?: boolean;
}

export interface FactInput {
  /** The same measurement the verdict came from, for the two facts that live on it. */
  availability: HarnessAvailability | undefined;
  /** How the program is obtained, when the row knows. */
  install?: { kind: "npx"; package: string } | { kind: "binary"; binary: string };
  /** The deep facts the daemon observed, when this row is one of the nine we ship. */
  harness?: HarnessSummary;
  /** The user's own names and whether the daemon has them. */
  env?: AgentProviderSummary["env"];
  /** Every environment variable the recipe supplies — a fact, and never something a user owes. */
  recipeEnv?: readonly string[];
  /** The command line this row would run, when the row has one to show. */
  commandLine?: string;
  /** The clock to measure "observed …" against. Injectable so the sentence is testable without waiting. */
  now?: number;
  locale: Locale;
  /**
   * The delivery in force for this row, from the wire. Absent means `installed` (a daemon older than the field
   * can only take that route), and only `npx` adds a fact — see `verdictFacts`.
   */
  delivery?: AgentDelivery;

}

/**
 * **The caveats, as plain facts — where the chips used to be.**
 *
 * The owner's vocabulary is explicit about this: caveats (`no approvals`, `cannot be cancelled`, `temporary
 * copy`) are *properties*, not chips. So is provenance, so is a sign-in requirement, and so is whether the
 * agent can be stopped — each is a fact about the row that is true or false, none of them changes whether the
 * row is *usable*, and a chip for each is how a nine-row list came to carry thirty chips.
 *
 * The mandate's own example of the shape is the sentence these render as:
 * `Asks before acting: no · Can be stopped: no · Temporary copy (npm cache)`.
 *
 * ## The deep facts, and the time they carry
 *
 * *"whether an agent needs a sign-in require starting it"* — so none of it is a verdict, and all of it carries
 * the time EnvoyDev observed it: `Verified` is `formatAgo`, which is the platform's own relative-time
 * formatter in the user's language (`4 minutes ago`), falling back to an absolute localised timestamp for
 * anything older than a week. When nothing has been observed the value says **why** — that EnvoyDev learns
 * this by starting the agent, which happens on a run rather than on this page — so a user is never invited to
 * hunt for a button that would tell them.
 */
export function verdictFacts(input: FactInput, t: Translate): RowFact[] {
  const facts: RowFact[] = [];
  const availability = input.availability;

  // Provenance first: it is the one fact that changes how much a user should trust the row's own path.
  if (availability?.provisional !== undefined) {
    facts.push({
      label: t("settings.agent.fact.provenance"),
      value: t(`settings.agent.provisional.${availability.provisional}`),
      caveat: true,
    });
  }

  if (input.commandLine !== undefined) {
    facts.push({ label: t("settings.agent.fact.runs"), value: input.commandLine });
  }

  /**
   * **How the connector is delivered** — and only when the user has chosen the fetched route.
   *
   * A `caveat`, for the reason `provisional` is one: it is the fact that changes how much a user should trust the
   * row's other answers. `Ready (npm, fetched on the first run)` is a different promise from `Ready` about a
   * program on this machine — the first run downloads something — and the row has to say which one it is making.
   * The `installed` route is the default and gets no fact: a caveat on every row is a caveat nobody reads.
   */
  if (input.delivery?.kind === "npx") {
    facts.push({
      label: t("settings.agent.fact.delivery"),
      value: t("settings.agent.fact.delivery.npx"),
      caveat: true,
    });
  }

  if (input.install !== undefined) {
    facts.push({
      label: t("settings.agent.fact.obtained"),
      value:
        input.install.kind === "npx"
          ? t("settings.agent.fact.obtained.npx", { package: input.install.package })
          : t("settings.agent.fact.obtained.path", {
              path: availability?.binary ?? input.install.binary,
            }),
    });
  }

  // The agent's own capabilities, as booleans rather than as chips. Two facts and not one sentence, because
  // they are independent and a user scans a label.
  if (input.harness !== undefined) {
    const capabilities = input.harness.capabilities;
    facts.push({
      label: t("settings.agent.fact.asksBefore"),
      value: capabilities.approvals ? t("settings.agent.fact.yes") : t("settings.agent.fact.no"),
      caveat: !capabilities.approvals,
    });
    facts.push({
      label: t("settings.agent.fact.canBeStopped"),
      value: capabilities.cancel ? t("settings.agent.fact.yes") : t("settings.agent.fact.no"),
      caveat: !capabilities.cancel,
    });
  }

  // A sign-in requirement is a fact about whether the agent will talk to us, and it is deliberately **not**
  // the verdict: the program is installed and drivable, which is what the verdict is about, and the action
  // that resolves it is the row's own `Sign in` button.
  if (input.harness !== undefined) {
    facts.push({
      label: t("settings.agent.fact.signIn"),
      value:
        input.harness.auth.state === "needs-signin"
          ? t("settings.agent.fact.signIn.needed")
          : input.harness.auth.state === "ready"
            ? t("settings.agent.fact.signIn.done")
            : t("settings.agent.fact.signIn.unknown"),
      caveat: input.harness.auth.state === "needs-signin",
    });
  }

  /**
   * **What the agent publishes about itself** — the deep facts, as properties.
   *
   * These are the facts that cannot be known without starting the agent, so they are here rather than on the
   * row, and the `Verified` fact below says when EnvoyDev last looked. Three of the four keep a distinction
   * the protocol makes and a renderer must not lose: `AgentThinking.kind === "session"` is *not* "none" — it
   * means the agent publishes its levels only inside a session and none has run yet — and
   * `AgentModels.kind === "free-text"` is not "no models" but "any model you type".
   */
  if (input.harness !== undefined) {
    const harness = input.harness;
    // A daemon from an older build does not send these two at all (`HarnessSummary` requires them, and the
    // window accepts the answer anyway — §7.2). Read defensively rather than crashing the page for a build
    // skew the row is already explaining.
    const models = harness.models as typeof harness.models | undefined;
    const thinking = harness.thinking as typeof harness.thinking | undefined;
    if (models === undefined || thinking === undefined) {
      facts.push({ label: t("settings.agent.fact.publishes"), value: t("settings.agent.notDeclared", { agent: harness.label }) });
    } else {
      facts.push({
        label: t("settings.agent.tier.title"),
        value: t(harness.tier === "built-in" ? "settings.agent.tier.builtIn" : "settings.agent.tier.catalogued"),
      });
      const modes = harness.modes.map((mode) => modeLabel(mode, t));
      facts.push({
        label: t("settings.agent.modes.title"),
        value: modes.length === 0 ? t("settings.agent.noneDeclared") : modes.join(", "),
      });
      facts.push({
        label: t("settings.agent.models.title"),
        value:
          models.kind === "free-text"
            ? t("settings.agent.modelsFreeText")
            : models.options.length === 0
              ? t("settings.agent.noneDeclared")
              : models.options.map((option) => option.label).join(", "),
      });
      facts.push({
        label: t("settings.agent.thinking.title"),
        value:
          thinking.kind === "session"
            ? t("settings.agent.thinkingSession")
            : thinking.options.length === 0
              ? t("settings.agent.noneDeclared")
              : thinking.options.map((option) => optionLabel(option, t)).join(", "),
      });
    }
  }

  // **The deep facts' time**, from the observations the daemon actually made. `models` and `thinking` carry
  // their own `observedAt` only when a *session* produced them (`AgentModels`), so the newest of the three is
  // the honest answer to "when did EnvoyDev last look at what this agent publishes".
  if (input.harness !== undefined) {
    const observed = [
      (input.harness.models as typeof input.harness.models | undefined)?.observedAt,
      (input.harness.thinking as typeof input.harness.thinking | undefined)?.observedAt,
      input.harness.auth?.observedAt,
    ]
      .filter((at): at is string => typeof at === "string" && at !== "")
      .sort()
      .at(-1);
    const now = input.now ?? Date.now();
    facts.push({
      label: t("settings.agent.fact.verified"),
      value:
        observed === undefined
          ? t("settings.agent.fact.verified.never")
          : `${formatAgo(observed, input.locale, now)} · ${formatWhen(observed, input.locale)}`,
    });
  }

  // A recipe's own constants: supplied by us, which is the fact a user needs in order not to go and export
  // one. `from === "catalogue"` is the daemon's own statement of that (see `AgentProviderEnvState`).
  for (const variable of input.env ?? []) {
    facts.push({
      label: variable.name,
      value:
        variable.from === "catalogue"
          ? t("settings.agent.fact.env.recipe")
          : variable.set
            ? t("settings.agent.fact.env.set")
            : t("settings.agent.fact.env.unset"),
      caveat: !variable.set,
    });
  }
  for (const name of input.recipeEnv ?? []) {
    facts.push({ label: name, value: t("settings.agent.fact.env.recipe") });
  }

  return facts;
}
