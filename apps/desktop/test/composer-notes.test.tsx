/**
 * **How much prose the composer is allowed to put above the field.**
 *
 * ## The report
 *
 * The owner, looking at a task with a turn running:
 *
 * > *"There are too many texts like 'The agent is still working in /Users/…/EnvoyMesh. A new folder applies to the
 * > next run.' / 'The agent keeps the mode it started with. Your choice applies to the next run.' / 'The agent keeps
 * > the model it started on. Your choice applies to the next run.' / 'Envoy Harness does not offer a thinking
 * > level.' These texts are usless, but make the chats inputting messy."*
 *
 * Four paragraphs, and three of them were the **same fact** told once per control. The reasoning that produced them
 * is recorded in `en.ts`'s own comment ("a user who changed only the folder should not be told about a mode they did
 * not touch") — but the sentences were not shown on interaction: they were shown whenever a turn was *running*, so
 * all three appeared at once, above the field the user was typing into.
 *
 * ## The rule this file holds
 *
 * A fact belongs where the user reaches for it:
 *
 *   * a control that cannot be used carries its reason **on itself** — `title` for a pointer, and a
 *     `visually-hidden` paragraph named by `aria-describedby` for a screen reader. The control is still drawn and
 *     still disabled; nothing is hidden, the explanation just arrives at the control;
 *   * the one fact all four controls share — a choice made while a turn is running applies to the **next** run — is
 *     said **once**, and only while a turn is running;
 *   * a failure the user just caused (a folder chooser that would not open) and an action they may need (the probe
 *     that is the only way to learn what the agent offers) take the line instead, because those are the things a
 *     user has to *act* on.
 *
 * The count is the assertion that can see all of this: **at most one `.composer__control-note`**, in every state.
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerControls, type ComposerControlsProps } from "../src/components/ComposerControls.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";

afterEach(cleanup);

/** Every control working, no turn running — the state in which the composer should say nothing at all. */
const WORKING: ComposerControlsProps = {
  modes: [{ id: "plan", label: "Plan" }],
  selectedModeId: "plan",
  onChooseMode: vi.fn(),
  modelKind: "listed",
  models: [{ id: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", model: "deepseek-chat" }],
  selectedModelId: "deepseek/deepseek-chat",
  agentLabel: "Envoy Harness",
  onChooseModel: vi.fn(),
  thinkingOptions: [],
  selectedThinkingLevel: undefined,
  onChooseThinking: vi.fn(),
  running: false,
};

function show(over: Partial<ComposerControlsProps> = {}): void {
  render(
    <I18nProvider preference="en">
      <ComposerControls {...WORKING} {...over} />
    </I18nProvider>,
  );
}

/** The visible lines of prose under the controls. */
const notes = (): string[] =>
  [...document.querySelectorAll(".composer__control-note")].map((node) => node.textContent ?? "");

describe("the composer's notes", () => {
  it("says nothing at all when nothing is running and every control works", () => {
    show();
    expect(notes()).toEqual([]);
  });

  it("says the shared fact once while a turn is running, instead of once per control", () => {
    // **The reported mess, in one assertion.** Three sentences used to appear here — one per control — each ending
    // "your choice applies to the next run". A mutation that puts any of them back makes this fail with four lines.
    show({ running: true });
    expect(notes()).toEqual([en["task.composer.appliesNextRun"]]);
  });

  it("puts a disabled control's reason on the control, and not in the composer", () => {
    // Envoy Harness offers no thinking level, so the picker is off — the owner's fourth sentence. The reason is
    // still *said*: it is the select's tooltip and the paragraph its `aria-describedby` names, which is what a
    // screen reader reads out with the control. What it is not is a paragraph above the message box.
    show({
      thinkingOff: { key: "task.composer.thinking.none", values: { agent: "Envoy Harness" } },
      running: true,
    });

    const reason = en["task.composer.thinking.none"].replace("{agent}", "Envoy Harness");
    const picker = screen.getByLabelText(en["task.composer.thinking.label"]) as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    // The tooltip is on the **chip**, not on the bare `<select>`: the chip is what a pointer lands on, and a
    // disabled control inside it takes no hover of its own.
    expect(picker.closest(".composer__chip")?.getAttribute("title")).toBe(reason);
    const describedBy = picker.getAttribute("aria-describedby");
    expect(describedBy).toBe("composer-thinking-reason");
    expect(document.getElementById(describedBy as string)?.textContent).toBe(reason);
    // …and the composer itself still shows the one line, not the reason as well.
    expect(notes()).toEqual([en["task.composer.appliesNextRun"]]);
  });

  it("does the same for the mode and the model, and for a list observed in a session", () => {
    show({
      modeOff: { key: "task.composer.agentMode.none", values: { agent: "Envoy Harness" } },
      modelKind: "none",
      modelOff: { key: "task.composer.model.none", values: { agent: "Envoy Harness" } },
      modelObservedAt: "2026-09-15T12:00:00.000Z",
      thinkingObservedAt: "2026-09-15T12:00:00.000Z",
      thinkingOptions: [{ value: "high", label: "High" }],
      selectedThinkingLevel: "high",
    });

    // The mode and the model are described by their own reasons…
    expect(
      screen.getByLabelText(en["task.composer.agentMode.label"]).closest(".composer__chip")?.getAttribute("title"),
    ).toBe(en["task.composer.agentMode.none"].replace("{agent}", "Envoy Harness"));
    expect(document.getElementById("composer-model-reason")?.textContent).toBe(
      en["task.composer.model.none"].replace("{agent}", "Envoy Harness"),
    );
    // …and a *working* control is described by what it is, never by a refusal: the thinking levels came from a
    // session, so its description is the observation, with the time in it.
    expect(document.getElementById("composer-thinking-reason")?.textContent).toContain("Envoy Harness");
    expect(notes()).toEqual([]);
  });

  it("no longer carries the folder at all — not the path, and not its failures", () => {
    // **The owner's first half.** *"we needn't to show the folder path on the inputting field"*: the folder,
    // its path, the chooser and the chooser's failures belong to the pane's header now (`task-pane.test.tsx`),
    // and this row is a toolbar of agent settings.
    show({ running: true });
    expect(screen.queryByLabelText(en["task.composer.folder.aria"])).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("/Users/you/work/api");
  });

  it("gives the line to the probe when there is an action to take", () => {
    // The one note that carries a control. It is the only way to learn what an agent offers when nothing has been
    // observed, so it outranks the next-run line.
    show({
      running: true,
      // A message with no key, which is what a daemon from an older build sends: `localize` falls back to the
      // sentence rather than to the key.
      probeNote: { message: "EnvoyCoder has not been told what Envoy Harness offers yet." },
      probeAction: { key: "task.composer.probe.ask", enabled: true },
      onProbeAgent: vi.fn(),
    });
    const lines = notes();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EnvoyCoder has not been told what Envoy Harness offers yet.");
    expect(screen.getByRole("button", { name: en["task.composer.probe.ask"].replace("{agent}", "Envoy Harness") })).toBeTruthy();
  });

  it("never draws more than one note, in any of the states above", () => {
    // The property, asserted over the states rather than one at a time — a fifth branch added later has to keep it.
    const states: Partial<ComposerControlsProps>[] = [
      {},
      { running: true },
      // The folder's own states are the pane header's now, and covered by `task-pane.test.tsx`.
      { running: true, probeNote: { message: "The agent answered and published nothing." } },
      { modeOff: { key: "task.composer.agentMode.unknown", values: { agent: "Codex" } }, running: true },
      {
        modelOff: { key: "task.composer.model.unknown", values: { agent: "Codex" } },
        probeAction: { key: "task.composer.probe.ask", enabled: true },
        onProbeAgent: vi.fn(),
      },
    ];
    for (const state of states) {
      cleanup();
      show(state);
      expect(notes().length, JSON.stringify(state)).toBeLessThanOrEqual(1);
    }
  });
});
