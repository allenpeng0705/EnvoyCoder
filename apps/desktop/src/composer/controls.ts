/**
 * What the composer shows, derived from **the agent the run is using**.
 *
 * The input area is the one screen every agent has to share, and agents differ: Claude offers
 * `plan`/`acceptEdits`/`bypassPermissions`, Codex `auto-review`/`full-access`, OpenCode `build`/`plan`,
 * Pi none at all. Some can cancel, some can ask us for approval, some can take an image. A composer
 * with a fixed set of controls therefore lies about at least one agent at all times — which is what ours
 * did, with a bare Queue/Steer select and no notion of the agent at all.
 *
 * This module is the *decision*, kept away from the rendering so it can be tested without a DOM: given
 * what the wire says about an agent (`coder.listHarnesses` now carries `modes`) and what the run is
 * doing, it returns the controls to draw, the send button's behaviour and label, and — for anything the
 * agent offers that we cannot yet honour — a **reason** rather than a hidden control.
 *
 * ## The three rules it encodes, each with a source
 *
 *   1. **An approval in flight forces `interrupt`.** Paseo does exactly this
 *      (`resolveActiveSendBehavior`), because a queued message behind a permission prompt is stranded:
 *      the turn is parked until somebody answers. See `docs/paseo-design-decisions.md`.
 *   2. **The send label states what will happen**, never just "Send": `Interrupt agent` while a turn
 *      runs, `Queue message` when it will wait, `Send and steer` when it joins.
 *   3. **A control we cannot honour is disabled with a reason, not hidden.** The mode picker is the live
 *      example: the agent's modes are known, and `coder.startRun` has no `agentModeId` field yet, so
 *      selecting one would be a silent no-op — the exact bug class we just removed from `resume`.
 */

/** The facts about one agent, straight from `coder.listHarnesses`. */
export interface ComposerAgent {
  id: string;
  label: string;
  modes: readonly { id: string; label: string; description?: string; unattended?: boolean }[];
  capabilities: {
    resume: boolean;
    cancel: boolean;
    approvals: boolean;
    structuredTools: boolean;
    streaming: boolean;
    images: boolean;
  };
  available: boolean | "unknown";
  /** Why it cannot be used, when it cannot. */
  unavailableReason?: string;
  /**
   * Can this daemon *apply* a mode it is given? Today: no — `coder.startRun` takes the send behaviour
   * (`mode: queue|steer`) and has no field for the agent's own mode. When that lands, this becomes true
   * and the picker turns on by itself.
   */
  modesApplicable?: boolean;
}

export interface ComposerState {
  /** Is a turn running right now? */
  running: boolean;
  /** Is an approval waiting for an answer? */
  approvalPending: boolean;
}

/** What sending will do. `interrupt` is the forced one. */
export type SendBehaviour = "send" | "queue" | "steer" | "interrupt";

export interface ComposerControl {
  /** A stable id the component can key on. */
  kind: "agent" | "mode" | "cancel" | "approvals" | "images";
  label: string;
  enabled: boolean;
  /** Present when `enabled` is false, and always user-facing: it is shown, not logged. */
  reason?: string;
}

export interface ComposerControls {
  agent: { id: string; label: string; available: boolean };
  mode: {
    options: readonly { id: string; label: string; description?: string; unattended?: boolean }[];
    selected: string | null;
    enabled: boolean;
    reason?: string;
  };
  send: { behaviour: SendBehaviour; label: string; enabled: boolean; reason?: string };
  /** The controls the agent's capabilities allow, in the order a composer should draw them. */
  controls: ComposerControl[];
  /** Anything worth telling the user about this agent, in their language. */
  notes: string[];
}

/**
 * The send button's text, from the behaviour and the run's state.
 *
 * Paseo's own chain: `Interrupt agent` while loading, `Queue message` when it will wait,
 * `Send and steer` / `Send and interrupt` when it will act on the running turn, `Send message` when
 * nothing is running. Users learn the difference by reading the button, so it has to say it.
 */
export function sendLabel(behaviour: SendBehaviour): string {
  switch (behaviour) {
    case "interrupt":
      return "Interrupt agent";
    case "queue":
      return "Queue message";
    case "steer":
      return "Send and steer";
    case "send":
      return "Send message";
  }
}

/** Which behaviour applies, given the run state and the user's preference. */
export function resolveSendBehaviour(
  state: ComposerState,
  preferred: "queue" | "steer" = "steer",
): SendBehaviour {
  // Rule 1, before the preference and before anything else: with an approval in flight, queueing would
  // park the message behind a turn that is itself parked.
  if (state.approvalPending) return "interrupt";
  if (!state.running) return "send";
  return preferred;
}

export function composerControls(
  agent: ComposerAgent,
  state: ComposerState,
  options: { preferred?: "queue" | "steer"; selectedModeId?: string } = {},
): ComposerControls {
  const notes: string[] = [];
  const capabilities = agent.capabilities;

  /* ── can we run it at all ── */
  const available = agent.available === true;
  if (!available) {
    notes.push(
      agent.available === "unknown"
        ? `EnvoyCoder has not checked whether ${agent.label} is installed yet.`
        : (agent.unavailableReason ?? `${agent.label} is not installed on this machine.`),
    );
  }

  /* ── the agent's own mode ── */
  const selected = options.selectedModeId ?? agent.modes.find((mode) => mode.unattended !== true)?.id ?? null;
  const modesKnown = agent.modes.length > 0;
  const modeEnabled = modesKnown && agent.modesApplicable === true && available;
  const modeReason = !modesKnown
    ? `${agent.label} does not offer selectable modes${capabilities.approvals ? " here" : ""}.`
    : agent.modesApplicable !== true
      ? `Choosing a mode for ${agent.label} is not wired up yet, so the picker is off rather than silently ignored.`
      : undefined;

  /* ── sending ── */
  const behaviour = resolveSendBehaviour(state, options.preferred ?? "steer");
  const sendEnabled = available;
  if (capabilities.approvals && agent.available === true) {
    // A fact worth surfacing: the agent can ask, so a stalled turn may be waiting on the user.
    notes.push(`${agent.label} can ask you before it acts.`);
  }
  if (!capabilities.cancel) {
    notes.push(`EnvoyCoder cannot stop ${agent.label} once it starts.`);
  }

  /* ── the controls the agent's capabilities allow ── */
  const controls: ComposerControl[] = [
    { kind: "agent", label: agent.label, enabled: available, ...(sendEnabled ? {} : { reason: notes[0] }) },
    { kind: "mode", label: "Mode", enabled: modeEnabled, ...(modeReason ? { reason: modeReason } : {}) },
    {
      kind: "cancel",
      label: "Stop",
      enabled: available && capabilities.cancel && state.running,
      ...(capabilities.cancel ? {} : { reason: `${agent.label} does not support stopping a turn.` }),
    },
    {
      kind: "approvals",
      label: "Approvals",
      enabled: available && capabilities.approvals,
      ...(capabilities.approvals ? {} : { reason: `${agent.label} never asks for approval, so there is nothing to answer.` }),
    },
    {
      kind: "images",
      label: "Attach an image",
      enabled: available && capabilities.images,
      ...(capabilities.images ? {} : { reason: `${agent.label} cannot read images.` }),
    },
  ];

  return {
    agent: { id: agent.id, label: agent.label, available },
    mode: {
      options: agent.modes,
      selected,
      enabled: modeEnabled,
      ...(modeReason ? { reason: modeReason } : {}),
    },
    send: {
      behaviour,
      label: sendLabel(behaviour),
      enabled: sendEnabled,
      ...(sendEnabled ? {} : { reason: notes[0] }),
    },
    controls,
    notes,
  };
}
