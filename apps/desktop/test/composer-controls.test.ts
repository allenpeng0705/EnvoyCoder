/**
 * The composer's controls, per agent.
 *
 * The claim under test is the one the product was failing: the input area adapts to the agent you chose,
 * and anything it *cannot* honour it disables **with a reason** instead of hiding quietly. Each case
 * below is a real agent from the catalogue, using the modes the wire now carries.
 */

import { describe, expect, it } from "vitest";

import {
  composerControls,
  resolveSendBehaviour,
  sendLabel,
  type ComposerAgent,
} from "../src/composer/controls.js";

function agent(over: Partial<ComposerAgent> = {}): ComposerAgent {
  return {
    id: "claudecode",
    label: "Claude Code",
    modes: [
      { id: "plan", label: "Plan" },
      { id: "acceptEdits", label: "Accept edits" },
      { id: "bypassPermissions", label: "Bypass", unattended: true },
    ],
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
    },
    available: true,
    ...over,
  };
}

const idle = { running: false, approvalPending: false };
const working = { running: true, approvalPending: false };
const blocked = { running: true, approvalPending: true };

describe("the send button says what will happen", () => {
  it("offers the plain send when nothing is running", () => {
    expect(resolveSendBehaviour(idle)).toBe("send");
    expect(sendLabel("send")).toBe("Send message");
  });

  it("follows the user's preference while a turn runs", () => {
    expect(resolveSendBehaviour(working, "steer")).toBe("steer");
    expect(resolveSendBehaviour(working, "queue")).toBe("queue");
    expect(sendLabel("steer")).toBe("Send and steer");
    expect(sendLabel("queue")).toBe("Queue message");
  });

  it("forces interrupt while an approval is pending, whatever the preference says", () => {
    // The rule from `docs/paseo-design-decisions.md`: queueing behind an approval strands the message,
    // because the turn is parked until somebody answers.
    expect(resolveSendBehaviour(blocked, "queue")).toBe("interrupt");
    expect(resolveSendBehaviour(blocked, "steer")).toBe("interrupt");
    expect(sendLabel("interrupt")).toBe("Interrupt agent");
  });
});

describe("the mode picker is honest about what it can do", () => {
  it("is off with a reason when the daemon cannot apply a mode yet", () => {
    const controls = composerControls(agent(), idle);
    expect(controls.mode.options).toHaveLength(3);
    expect(controls.mode.enabled).toBe(false);
    expect(controls.mode.reason).toMatch(/not wired up yet/);
    // A control that cannot work is still *shown* — hiding it would leave a user wondering whether the
    // agent has modes at all.
    expect(controls.controls.find((control) => control.kind === "mode")).toBeDefined();
  });

  it("turns on when the daemon can apply one, and preselects the first", () => {
    const controls = composerControls(agent({ modesApplicable: true }), idle);
    expect(controls.mode.enabled).toBe(true);
    expect(controls.mode.selected).toBe("plan");
    expect(controls.mode.reason).toBeUndefined();
  });

  it("honours an explicit selection, including the unattended mode", () => {
    const controls = composerControls(agent({ modesApplicable: true }), idle, { selectedModeId: "bypassPermissions" });
    expect(controls.mode.selected).toBe("bypassPermissions");
  });

  it("says plainly when an agent has no modes at all", () => {
    // Pi declares none, and that is a fact a user should be able to read.
    const controls = composerControls(agent({ id: "pi", label: "Pi", modes: [], modesApplicable: true }), idle);
    expect(controls.mode.enabled).toBe(false);
    expect(controls.mode.reason).toMatch(/does not offer selectable modes/);
  });
});

describe("the controls follow the agent's capabilities", () => {
  it("offers stop, approvals and images only when the agent supports them", () => {
    const full = composerControls(agent(), working);
    expect(full.controls.find((c) => c.kind === "cancel")?.enabled).toBe(true);
    expect(full.controls.find((c) => c.kind === "approvals")?.enabled).toBe(true);
    // Claude Code is text-only here: no images.
    expect(full.controls.find((c) => c.kind === "images")?.enabled).toBe(false);
  });

  it("explains a control the agent cannot do, rather than leaving it blank", () => {
    const noCancel = composerControls(
      agent({ capabilities: { ...agent().capabilities, cancel: false, images: true } }),
      working,
    );
    expect(noCancel.controls.find((c) => c.kind === "cancel")?.reason).toMatch(/does not support stopping/);
    expect(noCancel.notes.join(" ")).toMatch(/cannot stop Claude Code/);
    expect(noCancel.controls.find((c) => c.kind === "images")?.enabled).toBe(true);
  });

  it("disables sending for an agent that is not available, and says why", () => {
    const missing = composerControls(
      agent({ available: false, unavailableReason: "Claude Code is not installed (looked for claude on PATH)." }),
      idle,
    );
    expect(missing.send.enabled).toBe(false);
    expect(missing.send.reason).toMatch(/not installed/);
  });

  it("distinguishes 'we have not looked' from 'it is missing'", () => {
    const unknown = composerControls(agent({ available: "unknown" }), idle);
    expect(unknown.send.enabled).toBe(false);
    expect(unknown.send.reason).toMatch(/has not checked/);
  });
});
