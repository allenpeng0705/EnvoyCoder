/**
 * Every action a settings surface may call, as a spy that refuses.
 *
 * ## Why this is shared, and why it is typed as the interface
 *
 * Both settings tests used to build their own three-method object and cast it `as never`. That cast is
 * what let the stubs drift: `listPairedDevices` was added to `AgentActions` for the paired-devices
 * row, the real store implemented it, and the two stubs kept compiling — so the row called
 * `undefined` at render time and the failure surfaced as an unhandled `TypeError` beside a passing
 * test rather than as a compile error at the place the method was added.
 *
 * Returning `AgentActions` rather than a cast means the **compiler** holds the list: a new method on
 * the interface is a missing property here until somebody writes it, which is the moment to decide
 * what the test should answer with.
 *
 * ## Why every default is a refusal
 *
 * A refusal is the answer that cannot be mistaken for success. A stub that resolved `{ ok: true }`
 * would let a test prove a flow completed when nothing was wired — and the settings rows *render*
 * their refusals, so the default also gives every test a visible, harmless state to assert against.
 * Tests that care about a particular call override that one method:
 *
 * ```ts
 * const actions = stubAgentActions({
 *   listPairedDevices: vi.fn(async () => ({ ok: true, devices: [] })),
 * });
 * ```
 */

import { vi } from "vitest";

import type { AgentActions } from "../../src/state/agent-actions.js";

/** What an unwired call answers: the shape of a refusal, with no catalogue key to localise. */
const REFUSAL = {
  ok: false as const,
  message: "This test does not wire that action.",
};

export function stubAgentActions(overrides: Partial<AgentActions> = {}): AgentActions {
  // Declared `AgentActions`, so each property is contextually typed by the interface it stands in
  // for: `async () => REFUSAL` then has to be a legal answer *for that method*, which is what makes
  // a wrong or missing method a compile error rather than a runtime `undefined`.
  const base: AgentActions = {
    addProvider: vi.fn(async () => REFUSAL),
    removeProvider: vi.fn(async () => REFUSAL),
    setAgentDelivery: vi.fn(async () => REFUSAL),
    runFix: vi.fn(async () => REFUSAL),
    // The one action that answers nothing: a void return rather than a refusal, because the daemon
    // re-emits the harness list and the store re-reads through its ordinary loaders.
    recheckAgents: vi.fn(async () => undefined),
    signInAgent: vi.fn(async () => REFUSAL),
    mintPairing: vi.fn(async () => REFUSAL),
    listPairedDevices: vi.fn(async () => REFUSAL),
    revokePairedDevice: vi.fn(async () => REFUSAL),
    forgetPairedDevice: vi.fn(async () => REFUSAL),
  };
  return { ...base, ...overrides };
}
