/**
 * The pane, rendered from real run events.
 *
 * ## What this adds over `transcript.test.ts`
 *
 * That test proves the folding; this one proves the folding reaches the screen and that the controls
 * are wired to the right events. The distinction is not academic — the scaffold's own lesson is that
 * a component which throws on a missing field passes every unit test in the library beneath it
 * (`AGENTS.md`, "Tests and the bundle are different proofs").
 *
 * Two things here are M3's actual acceptance, in a form a test can hold: an escalation is rendered
 * as a **card in the transcript** with the agent's own options, and answering it sends the option id
 * back — and the composer's two modes send *different* values, which is the only way "Queue and
 * Steer behave differently" is checkable without reading the daemon's code.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarnessSummary, Project, RunEvent, Task } from "@envoycoder/protocol";
import { withMessageRef } from "@envoycoder/protocol";

import { canApplyModel, canApplyThinking, harnessModels, harnessThinking, HARNESS_CATALOG } from "@envoycoder/agent-catalog";

import { TaskPane } from "../src/components/TaskPane.js";

// Testing-library only auto-cleans when vitest globals are on, which this repo does not use.
afterEach(() => {
  cleanup();
  // The folder chooser belongs to the shell, so a test that lends the window one has to take it back:
  // "this window has no chooser" is itself an assertion in the tests below.
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
});

const task: Task = {
  id: "w1",
  projectId: "local::/repo",
  cwd: "/repo",
  title: "Add idempotency keys",
  harness: "deepseek-harness",
  model: "deepseek-official/deepseek-v4-flash",
  status: "needs-attention",
  createdAt: "2026-09-13T10:00:00.000Z",
  updatedAt: "2026-09-13T10:01:00.000Z",
  runId: "r1",
};

const project: Project = {
  id: "local::/repo",
  path: "/repo",
  label: "payments-api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

const base = { runId: "r1", taskId: "w1", at: "2026-09-13T10:00:00.000Z" };
let seq = 0;
function event(payload: Record<string, unknown>): RunEvent {
  seq += 1;
  return { ...base, seq, ...payload } as RunEvent;
}

/**
 * One agent, exactly as `coder.listHarnesses` carries it.
 *
 * The two entries here are the two real ones, because the *point* of these controls is that the wire
 * decides what they offer: `envoy-harness` declares the three `ModeKind`s, accepts `session/set_mode`,
 * and publishes its provider defaults as a model list; `deepseek-harness` has no such mode method and
 * publishes no model list we can read before a run — it takes free text instead. The model facts are
 * read from the catalogue rather than typed out here, so a change to what the catalogue claims shows up
 * in this test instead of being shadowed by a stale copy of the old answer.
 */
function harnessFor(
  id: "envoy-harness" | "deepseek-harness",
  over: Partial<HarnessSummary> = {},
): HarnessSummary {
  const capabilities = {
    resume: true,
    cancel: true,
    approvals: true,
    structuredTools: true,
    streaming: true,
    images: false,
    agentMode: id === "envoy-harness",
    model: canApplyModel(id),
    thinking: canApplyThinking(id),
    // The fourth delivery flag, added by settings slice 1, and read from the catalogue like the three
    // above rather than typed out: this is what the settings pane's approvals row is enabled on
    // (`session/set_policy`), and a copy written here would let the wire and that row disagree.
    approvalPolicy: HARNESS_CATALOG[id].capabilities.approvalPolicy,
  };
  return {
    id,
    label: id === "envoy-harness" ? "Envoy Harness" : "DeepSeek Harness",
    tier: id === "envoy-harness" ? "built-in" : "catalogued",
    summary: "…",
    modes:
      id === "envoy-harness"
        ? [
            { id: "default", label: "Default", labelKey: "task.agentMode.default.label", descriptionKey: "task.agentMode.default.description" },
            { id: "plan", label: "Plan", labelKey: "task.agentMode.plan.label", descriptionKey: "task.agentMode.plan.description" },
            { id: "review", label: "Review", labelKey: "task.agentMode.review.label", descriptionKey: "task.agentMode.review.description" },
          ]
        : [],
    models: harnessModels(id),
    // Read from the catalogue rather than typed out here, on the same principle as `models`: a change to
    // what the catalogue claims shows up in this test instead of being shadowed by a stale copy. For
    // `envoy-harness` that is the observed-none answer; for `deepseek-harness` it is "publishes its
    // levels only inside a session", which is the state the pill's "not told yet" sentence exists for.
    thinking: harnessThinking(id),
    capabilities,
    availability: { state: "ready" as const, binary: "/usr/local/bin/agent" },
    // The auth fact, at the value a running daemon sends before anything has probed: `unknown`, which asserts
    // nothing. `...over` still comes last, so a test that wants it changed can say so.
    auth: { state: "unknown" as const },
    evidence: "cited in `@envoycoder/agent-catalog`",
    ...over,
  };
}

/** Give this window a shell with a folder chooser, the way the desktop app has one. */
function lendShell(invoke: () => Promise<unknown>): void {
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
}

function renderPane(
  events: RunEvent[],
  overrides: Partial<Parameters<typeof TaskPane>[0]> = {},
): ReturnType<typeof render> & {
  onSend: ReturnType<typeof vi.fn>;
  onAnswer: ReturnType<typeof vi.fn>;
  onStart: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onSend = vi.fn();
  const onAnswer = vi.fn();
  const onStart = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <TaskPane
      task={task}
      project={project}
      events={events}
      runLive
      onSend={onSend}
      onAnswer={onAnswer}
      onStart={onStart}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return Object.assign(result, { onSend, onAnswer, onStart, onCancel });
}

describe("the pane's header", () => {
  it("says which machine the work is on, and what it is working in", () => {
    renderPane([]);
    // "This machine" is a statement, not an omission: a distributed control plane that leaves it out
    // invites the user to assume "here" and then wonder why a passing test fails in the transcript.
    expect(screen.getByText("This machine")).toBeTruthy();
    expect(screen.getByText("payments-api")).toBeTruthy();
    expect(screen.getByText("DeepSeek Harness")).toBeTruthy();
    expect(screen.getByText("deepseek-official/deepseek-v4-flash")).toBeTruthy();
    // The status is the end-user wording, never the internal bucket.
    expect(screen.getByText("Needs your answer")).toBeTruthy();
  });

  it("teaches a new user what will happen, rather than showing a blank panel", () => {
    renderPane([]);
    const transcript = screen.getByTestId("transcript");
    expect(within(transcript).getByText("Nothing yet")).toBeTruthy();
    expect(within(transcript).getByText(/the agent works in/i)).toBeTruthy();
  });
});

describe("the transcript", () => {
  it("renders what the agent said, and the user's own message as joined or waiting", () => {
    renderPane([
      event({ kind: "run.message", text: "add the keys", mode: "steer", delivered: "steered" }),
      event({ kind: "run.output", stream: "assistant", text: "On it.", messageId: "m1" }),
    ]);

    expect(screen.getByText("add the keys")).toBeTruthy();
    expect(screen.getByText("On it.")).toBeTruthy();
    // The distinction the composer exists to make, rendered where a user can see it after the fact.
    expect(screen.getByText(/joined the turn/)).toBeTruthy();
  });

  it("puts reasoning behind a summary instead of in the reader's way", () => {
    renderPane([
      event({ kind: "run.thought", text: "perhaps the parser is wrong", messageId: "m1" }),
      event({ kind: "run.output", stream: "assistant", text: "The parser is wrong.", messageId: "m2" }),
    ]);
    // Present, but collapsed: long reasoning in front of the answer is how a transcript becomes
    // unreadable at exactly the moment it matters.
    const summary = screen.getByText("How it thought about this");
    expect(summary).toBeTruthy();
    expect(summary.closest("details")?.open).toBe(false);
  });

  it("says when the history is incomplete rather than rendering a plausible lie", () => {
    renderPane([
      event({ kind: "run.output", stream: "assistant", text: "one", messageId: "m1" }),
      { ...base, seq: 9, kind: "run.output", stream: "assistant", text: "nine", messageId: "m2" } as RunEvent,
    ]);
    expect(screen.getByText(/did not arrive/)).toBeTruthy();
  });
});

describe("an approval, inline", () => {
  const approval = event({
    kind: "run.approval-requested",
    requestId: "req-1",
    question: "Allow the agent to run “shell”?",
    detail: "It has stopped before this step and will not continue until you answer.",
    options: [
      { id: "allow-once", label: "Allow once" },
      { id: "reject-once", label: "Reject", destructive: true },
    ],
  });

  it("is a card in the transcript, with the agent's own options and no modal", () => {
    renderPane([approval]);

    const card = screen.getByRole("alertdialog", { name: "The agent needs your answer" });
    // In the transcript, next to the call that raised it — a modal would block the window and hide
    // the context the user needs to decide (`docs/envoycoder-ui.md` §6).
    expect(within(screen.getByTestId("transcript")).getByRole("alertdialog")).toBeTruthy();
    expect(within(card).getByText("Allow the agent to run “shell”?")).toBeTruthy();
    // The labels are the agent's, not ones we invented: two surfaces wording one decision
    // differently is how a user comes to trust neither.
    expect(within(card).getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("answers with the option the agent offered, by id", () => {
    const pane = renderPane([approval]);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Allow once" }));
    // The id, not the label: the label is for the user, and the protocol speaks in ids.
    expect(pane.onAnswer).toHaveBeenCalledWith("req-1", "allow-once");
  });

  it("stops being a question once it is answered, and stays where it was", () => {
    renderPane([
      approval,
      event({ kind: "run.approval-resolved", requestId: "req-1", optionId: "allow-once", by: "you" }),
      event({ kind: "run.output", stream: "assistant", text: "done", messageId: "m1" }),
    ]);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    // In place, showing what was chosen — an answered card that vanished would take the reader's
    // place in a long transcript with it.
    expect(screen.getByText("Answered: Allow once")).toBeTruthy();
  });

  it("refuses to send a message while the agent is waiting on an answer", () => {
    renderPane([approval]);
    // Queueing behind a prompt strands the words, so the composer says so rather than accepting
    // them and dropping them behind a decision that has not been made.
    const send = screen.getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Message the agent").getAttribute("placeholder")).toMatch(
      /Answer the request above/,
    );
  });
});

describe("the composer", () => {
  it("sends the mode the user chose, so the two controls are not decorative", () => {
    const pane = renderPane([]);
    // `fireEvent.change` rather than assigning `.value`: a controlled input's state lives in React,
    // and a raw DOM event leaves React's copy stale — which would make this test pass on a component
    // that ignored typing entirely.
    fireEvent.change(screen.getByLabelText("Message the agent"), {
      target: { value: "and make it idempotent too" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(pane.onSend).toHaveBeenCalledWith("and make it idempotent too", "queue");

    // Sending clears the box — asserted here because the second send below would otherwise be a
    // duplicate of the first rather than a test of the other mode.
    expect((screen.getByLabelText("Message the agent") as HTMLTextAreaElement).value).toBe("");
    pane.onSend.mockClear();
    fireEvent.change(screen.getByLabelText("Message the agent"), {
      target: { value: "and make it idempotent too" },
    });
    fireEvent.change(screen.getByLabelText("How to deliver the message"), { target: { value: "steer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(pane.onSend).toHaveBeenCalledWith("and make it idempotent too", "steer");
  });

  it("hides the mode picker when there is no turn to join", () => {
    renderPane([], { runLive: false });
    // Offering "Queue or Steer" on a finished task is a choice that does nothing.
    expect(screen.queryByLabelText("How to deliver the message")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("starts a task when nothing is running, rather than sending to a run that does not exist", () => {
    const pane = renderPane([], { runLive: false });
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "bump the SDK" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // The task's model travels with the first message: `task` here remembers
    // `deepseek-official/deepseek-v4-flash`, and a run started from this pane has to be the run on the
    // model the pane shows. The mode is `undefined` because `deepseek-harness` has none to offer.
    expect(pane.onStart).toHaveBeenCalledWith(
      "bump the SDK",
      undefined,
      "deepseek-official/deepseek-v4-flash",
      // `undefined` for the thinking level, on the same terms as the mode: `deepseek-harness` accepts
      // one, and this task has none chosen and no session observed to choose from, so the run leaves the
      // decision to the agent rather than sending a level nobody picked.
      undefined,
    );
    expect(pane.onSend).not.toHaveBeenCalled();
  });

  it("offers Stop only while there is something to stop", () => {
    const running = renderPane([]);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    running.onCancel.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(running.onCancel).toHaveBeenCalled();

    cleanup();
    renderPane([], { runLive: false });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

describe("a task that has not started yet", () => {
  it("starts the run from the first message, with no mode to choose", () => {
    // This is the state "+ New" leaves a task in: created, selected, nothing running. The composer is
    // the form — so the first thing typed starts the work rather than queueing behind a run that does
    // not exist, and the queue/steer picker is absent because there is no turn to join.
    const { onStart, onSend } = renderPane([], {
      task: { ...task, title: "", runId: undefined },
      runLive: false,
    });
    const field = screen.getByLabelText("Message the agent");
    fireEvent.change(field, { target: { value: "Add a health check endpoint" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onStart).toHaveBeenCalledWith(
      "Add a health check endpoint",
      undefined,
      "deepseek-official/deepseek-v4-flash",
      undefined,
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("How to deliver the message")).toBeNull();
  });

  it("calls an unnamed task by this app's word for it", () => {
    renderPane([], { task: { ...task, title: "", runId: undefined }, runLive: false });
    expect(screen.getByText("Untitled")).toBeTruthy();
  });
});

describe("the new chat, which is where a session starts", () => {
  it("offers a way in, and the chip fills the field without sending it", () => {
    // An empty composer with no idea what to type is the other half of "hard to use". The chip is a
    // sentence the user can edit; sending it for them would be a surprise, not help.
    const { onStart } = renderPane([], { task: { ...task, title: "", runId: undefined }, runLive: false });
    fireEvent.click(screen.getByRole("button", { name: "Explain what this project does" }));

    const field = screen.getByLabelText("Message the agent") as HTMLTextAreaElement;
    expect(field.value).toBe("Explain what this project does");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("says how to send, on the screen rather than only in a comment", () => {
    renderPane([], { runLive: false });
    expect(screen.getByText("Enter to send · Shift+Enter for a new line")).toBeTruthy();
  });

  it("keeps the field and the send action in one card, so the composer reads as one control", () => {
    renderPane([], { runLive: false });
    const card = document.querySelector(".composer__card");
    expect(card).toBeTruthy();
    expect(card?.contains(screen.getByLabelText("Message the agent"))).toBe(true);
    expect(card?.contains(screen.getByRole("button", { name: "Start" }))).toBe(true);
  });

  it("draws the user's own turn as a bubble, not a row with a coloured rule", () => {
    // Alignment is what lets a reader find their last message without re-reading the screen — the thing
    // a transcript of identically-shaped rows cannot do.
    renderPane([event({ kind: "run.message", text: "add the keys", mode: "steer", delivered: "steered" })]);
    const row = document.querySelector(".row--user");
    expect(row).toBeTruthy();
    expect(row?.querySelector(".row__text")?.textContent).toBe("add the keys");
  });
});

/**
 * The two controls above the field: the task's folder, and the agent's own mode.
 *
 * Three things are asserted, and each is a way the naive version lies:
 *
 *   1. **The folder shown is the folder used.** Truncated for the pill, whole in its `title` — a user
 *      deciding "is my agent in the right repository?" reads the end of a path, not the beginning.
 *   2. **The picker's enabled state comes off the wire.** `capabilities.agentMode` is the only thing
 *      that turns it on; an agent with modes it cannot be *set* into gets a disabled picker and a
 *      sentence saying so, and an agent we have not been told about gets a *different* sentence.
 *   3. **A live run is said once, not once per control.** The agent is launched with `task.cwd` and put
 *      into its mode right after `session/new`, so no control can move or re-mode a run already going —
 *      and pretending otherwise is how a user concludes the app ignored them. That fact is now one line
 *      under the row (`composer-notes.test.tsx` holds the count); what each control carries here is its
 *      **own** reason, on itself, when it cannot be used.
 */
describe("the folder control", () => {
  const nested = { ...task, cwd: "/repo/packages/api" };

  it("shows the folder relative to the project, with the whole path in the title", () => {
    renderPane([], { task: nested });
    const pill = screen.getByLabelText("Change this task's folder");
    // Relative, because that is the shape a user recognises: the project is already named in the header.
    expect(pill.textContent).toBe("packages/api");
    // Nothing is hidden: the full path is one hover away. (The title *contains* it rather than being it, because
    // a window with no chooser appends the reason to the same hover — see the leg below.)
    expect(pill.getAttribute("title")).toContain("/repo/packages/api");
  });

  it("is disabled with the reason on itself when this window has no chooser", () => {
    // A browser dev server, or Linux without zenity. A button that silently does nothing is worse than one that
    // says why it cannot — and "why" now travels **on the pill**: its tooltip for a pointer, and a
    // `visually-hidden` paragraph its `aria-describedby` names for a screen reader. It is not a paragraph under
    // the row, because a permanent property of the window is not news (§7.30).
    renderPane([], { task: nested, onChangeFolder: vi.fn() });
    const pill = screen.getByLabelText("Change this task's folder") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
    expect(pill.title).toContain("no folder chooser");
    // The path is still in the title too: both answers come from the same hover.
    expect(pill.title).toContain("/repo/packages/api");
    const describedBy = pill.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/no folder chooser/i);
    // Nothing visible was added for it: the reason is attached to the pill. The only line the composer has
    // here is the run's own — `renderPane` renders a live run by default, so that line is expected, and the
    // point is that the *reason* is not a second one.
    const notes = [...document.querySelectorAll(".composer__control-note")];
    expect(notes.map((node) => node.textContent)).toEqual(["Applies to the next run."]);
  });

  it("changes the folder through the shell's picker when there is one", async () => {
    lendShell(async () => "/elsewhere/deep/api");
    const onChangeFolder = vi.fn();
    renderPane([], { task: nested, onChangeFolder });

    const pill = screen.getByLabelText("Change this task's folder") as HTMLButtonElement;
    expect(pill.disabled).toBe(false);
    fireEvent.click(pill);

    // The chosen path, not the one on screen: the click is a request, and the daemon is what decides
    // whether the folder exists.
    await waitFor(() => expect(onChangeFolder).toHaveBeenCalledWith("/elsewhere/deep/api"));
  });

  it("says a closed dialog changed nothing, and does not invent a failure for it", async () => {
    lendShell(async () => null);
    const onChangeFolder = vi.fn();
    renderPane([], { task: nested, onChangeFolder });
    fireEvent.click(screen.getByLabelText("Change this task's folder"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onChangeFolder).not.toHaveBeenCalled();
    expect(screen.queryByText(/could not open/i)).toBeNull();
  });

  it("says a live run keeps its settings, once, without naming the folder it is in", () => {
    lendShell(async () => null);
    renderPane([], { task: nested, runLive: true, onChangeFolder: vi.fn() });
    // Not a disabled control: the choice is real and will be used. It is the *running* agent that keeps the
    // directory it started in — and the path is already on the pill, so the old sentence said it twice.
    const notes = [...document.querySelectorAll(".composer__control-note")];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe("Applies to the next run.");
    expect(screen.queryByText(/still working in/)).toBeNull();
  });
});

describe("the agent's mode control", () => {
  const envoyTask = { ...task, harness: "envoy-harness" as const };

  it("offers the modes the wire declares, in our language, and saves the choice", async () => {
    const onChangeMode = vi.fn();
    renderPane([], { task: envoyTask, harnesses: [harnessFor("envoy-harness")], onChangeMode });

    const picker = screen.getByLabelText("Mode") as HTMLSelectElement;
    expect(picker.disabled).toBe(false);
    // The labels come from the catalogue, by key, because *we* wrote them — an agent's own mode names
    // would arrive without keys and be shown as the agent wrote them.
    expect([...picker.options].map((option) => option.textContent)).toEqual(["Default", "Plan", "Review"]);

    fireEvent.change(picker, { target: { value: "plan" } });
    expect(onChangeMode).toHaveBeenCalledWith("plan");
  });

  it("is disabled with the reason shown for an agent whose protocol has no modes", () => {
    // The real `deepseek-harness` shape: it speaks ACP, it has no `session/set_mode`, and its own
    // per-session configuration is the model and the reasoning effort. Offering a plan picker here
    // would be offering a control that does nothing.
    renderPane([], { task, harnesses: [harnessFor("deepseek-harness")] });
    const picker = screen.getByLabelText("Mode") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(screen.getByText("DeepSeek Harness does not offer selectable modes.")).toBeTruthy();
  });

  it("is disabled even when modes are declared, if the daemon cannot set one", () => {
    // The state the wire permits and the catalogue really uses: a `catalogued` CLI entry declares its
    // modes (they come from Paseo's provider manifest) while `capabilities.agentMode` is false, because
    // we cannot drive that agent at all. A picker keyed on "the agent has modes" alone would be enabled
    // here, and every choice a user made would go nowhere.
    const declared = harnessFor("envoy-harness", {
      capabilities: { ...harnessFor("envoy-harness").capabilities, agentMode: false },
    });
    renderPane([], { task: envoyTask, harnesses: [declared] });

    const picker = screen.getByLabelText("Mode") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    // …and the options are still *listed*, so a user can see what the agent offers even though this
    // build cannot choose for it.
    expect([...picker.options].map((option) => option.textContent)).toEqual(["Default", "Plan", "Review"]);
    expect(screen.getByText(/not wired up yet/)).toBeTruthy();
  });

  it("says it has not been told yet, which is not the same as 'this agent has none'", () => {
    // The list arrives asynchronously, and a pane with no daemon has none at all. Reporting an agent's
    // *lack* of modes when the truth is our own ignorance is the mistake this asserts against.
    renderPane([], { task: envoyTask });
    expect(screen.getByText(/has not been told which modes Envoy Harness offers yet/)).toBeTruthy();
    expect(screen.queryByText(/does not offer selectable modes/)).toBeNull();
  });

  it("sends the chosen mode with the first message, so the picker is not decorative", () => {
    const { onStart } = renderPane([], {
      task: envoyTask,
      harnesses: [harnessFor("envoy-harness")],
      runLive: false,
    });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "plan" } });
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "plan it out" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // Four arguments now, and the fourth is asserted rather than ignored: `envoy-harness` offers no
    // thinking level, so the run must be started with none. A call that carried `undefined` there by
    // accident and one that carried a level would otherwise look identical to this test.
    expect(onStart).toHaveBeenCalledWith(
      "plan it out",
      "plan",
      "deepseek-official/deepseek-v4-flash",
      undefined,
    );
  });

  it("sends no mode at all when the picker is off, so the agent's own default stands", () => {
    // The negative half of the test above, and the reason `onStart`'s second argument is optional: an
    // app that always sent something would override whatever the user configured in the agent itself.
    const { onStart } = renderPane([], {
      task,
      harnesses: [harnessFor("deepseek-harness")],
      runLive: false,
    });
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "just do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onStart).toHaveBeenCalledWith(
      "just do it",
      undefined,
      "deepseek-official/deepseek-v4-flash",
      undefined,
    );
  });

  it("says a live run keeps its settings once, and does not put a sentence under each control", () => {
    renderPane([], { task: envoyTask, runLive: true, harnesses: [harnessFor("envoy-harness")] });
    // The three per-control "your choice applies to the next run" sentences were the same fact three times over,
    // above the field the user was typing into. One line now, and each control carries only its *own* reason.
    expect(document.querySelectorAll(".composer__control-note")).toHaveLength(1);
    expect(screen.queryByText(/keeps the mode it started with/)).toBeNull();
    expect(screen.queryByText(/still working in/)).toBeNull();
  });
});

/**
 * The model control on screen.
 *
 * ## The three shapes, and why this is not one component
 *
 * A published list is a `<select>`; an agent that publishes nothing and takes a value is a **text
 * field**; an agent that takes no model is disabled with the reason under it. The middle case is the one
 * worth rendering rather than reasoning about: `deepseek-harness` is the agent this app's default task
 * runs on, it has no list before a session exists, and a control that decided from `options.length`
 * would render it as a dead pill.
 *
 * The last test is the one that proves the choice is not decorative: the model the user picked has to
 * travel on `onStart`, which is the argument the daemon launches the agent with.
 */
describe("the model control", () => {
  const envoyTask = { ...task, harness: "envoy-harness" as const, model: undefined };

  it("lists the models the agent publishes, and takes the agent's own default as a choice", () => {
    renderPane([], { task: envoyTask, harnesses: [harnessFor("envoy-harness")], runLive: false });

    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.disabled).toBe(false);
    // The empty option is first and is the state a task is in before anybody chooses — an agent running
    // on whatever it defaults to. It is a *choice* here, and picking it is how a user undoes a model.
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      "The agent's own default",
      "gpt-4o",
      "claude-sonnet-4-6",
      "deepseek-chat",
      "MiniMax-M3",
      "glm-4-flash",
      "qwen-plus",
      "llama3.1",
    ]);
    expect(picker.value).toBe("");
    for (const option of [...picker.options]) {
      // The id is the value, because it is what the task stores and what the daemon resolves.
      if (option.value !== "") expect(option.value).toContain("/");
    }
  });

  it("gives an agent with no published list a usable text field, not a disabled pill", () => {
    // `deepseek-harness`'s models live in a live session's `configOptions`. There is nothing to list
    // here and still something to set, so the control is a field — and the sentence under it says which
    // shape the value has to be, because that is the one thing a user cannot guess.
    renderPane([], { task: { ...task, harness: "deepseek-harness" as const, model: undefined }, harnesses: [harnessFor("deepseek-harness")], runLive: true });

    const field = screen.getByLabelText("Model") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(field.disabled).toBe(false);
    expect(field.placeholder).toBe("provider/model");
    // The instruction about the value's shape travels **with the field** — its tooltip, and the paragraph its
    // `aria-describedby` names — instead of as a paragraph under the row.
    expect(field.title).toMatch(/publishes its models only inside a running session/);
    const describedBy = field.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /publishes its models only inside a running session/,
    );
    // And a live run is one line about the run, not a sentence per control.
    expect(document.querySelectorAll(".composer__control-note")).toHaveLength(1);
    // Not the refusal sentences: nothing here is being refused.
    expect(screen.queryByText(/does not take a model/)).toBeNull();
    expect(screen.queryByText(/not wired up yet/)).toBeNull();
  });

  it("commits a complete value from the text field, and holds a half-typed one back", () => {
    // A draft is not a model. Saving `deepseek` on the way to `deepseek/deepseek-chat` would store a
    // value that makes the next run refuse, so only a value naming both halves is handed upwards.
    const onChangeModel = vi.fn();
    renderPane([], {
      task: { ...task, harness: "deepseek-harness" as const, model: undefined },
      harnesses: [harnessFor("deepseek-harness")],
      runLive: false,
      onChangeModel,
    });

    const field = screen.getByLabelText("Model");
    fireEvent.change(field, { target: { value: "deepseek" } });
    fireEvent.blur(field);
    expect(onChangeModel).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "deepseek/deepseek-chat" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChangeModel).toHaveBeenCalledWith("deepseek/deepseek-chat");
  });

  it("sends the model the user picked with the first message, so the control is not decorative", () => {
    const { onStart } = renderPane([], {
      task: envoyTask,
      harnesses: [harnessFor("envoy-harness")],
      runLive: false,
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "anthropic/claude-sonnet-4-6" },
    });
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "use sonnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // The third argument is what `coder.startRun` carries, and the daemon is what turns it into
    // `--provider`/`--model` (envoy-harness) or the session config (deepseek-harness). The fourth is
    // `undefined` here because this agent declared no thinking levels in the summary, which is the
    // "not told yet" state — the run is started without a level rather than with an invented one.
    expect(onStart).toHaveBeenCalledWith("use sonnet", "default", "anthropic/claude-sonnet-4-6", undefined);
  });

  it("clears the model when the user picks the agent's own default, rather than storing nothing", () => {
    // `""` is the request "the agent's own default" — the only way to undo a model without replacing it
    // — and it must reach the daemon as-is, because the daemon is what decides to drop the stored key
    // instead of saving an empty string that would show up as a model chip on the task header.
    const onChangeModel = vi.fn();
    renderPane([], {
      task: { ...task, model: "deepseek-official/deepseek-v4-flash" },
      harnesses: [harnessFor("deepseek-harness")],
      onChangeModel,
    });

    const field = screen.getByLabelText("Model");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onChangeModel).toHaveBeenCalledWith("");
  });

  it("disables the control with the reason, and shows the published models anyway", () => {
    // A catalogued CLI that records a model flag but cannot be launched: the list stays visible so the
    // gap reads as "this build cannot do it yet", not as "this agent has no models".
    const declared = harnessFor("envoy-harness", {
      id: "claudecode",
      label: "Claude Code",
      tier: "catalogued",
      capabilities: { ...harnessFor("envoy-harness").capabilities, model: false },
    });
    renderPane([], { task: { ...envoyTask, harness: "claudecode" }, harnesses: [declared] });

    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect([...picker.options].length).toBe(8);
    expect(screen.getByText(/not wired up yet/)).toBeTruthy();
  });

  it("says it has not been told yet, rather than blaming the agent", () => {
    // The same distinction the mode picker makes: the harness list arrives asynchronously, and a pane
    // rendered without a daemon has none at all. Reporting the agent's *lack* of models when the truth
    // is our own ignorance is the mistake this asserts against.
    renderPane([], { task: envoyTask });
    expect(screen.getByText(/has not been told which models Envoy Harness offers yet/)).toBeTruthy();
    expect(screen.queryByText(/does not take a model/)).toBeNull();
  });
});

/**
 * The thinking control on screen.
 *
 * ## The state this test exists for
 *
 * A thought level is knowable only from a session, so the interesting rendering is not the picker — it is
 * the two ways there is no picker, and telling them apart. `deepseek-harness` publishes its levels inside
 * a session and nobody has opened one yet ("we have not looked"); `envoy-harness` has no such method at
 * all ("it offers none"). A component that rendered one sentence for both would tell the user their agent
 * cannot think in steps, which one run disproves.
 *
 * The observed state is the third: a list a real session published, said out loud to be what it is,
 * because a level is derived from the model that session resolved and may not survive a model change.
 */
describe("the thinking control", () => {
  const deepseek = { ...task, harness: "deepseek-harness" as const, thinkingLevel: undefined };
  const LEVELS = {
    kind: "listed" as const,
    options: [
      { value: "off", label: "Off", description: "Use for simple tasks." },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "max", label: "Max" },
    ],
    observedAt: "2026-09-14T05:23:00.000Z",
    source: "observed from the session opened at …",
  };

  it("lists the levels a session published, with the agent's own words and a way back to the default", () => {
    renderPane([], {
      task: deepseek,
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: false,
    });

    const picker = screen.getByLabelText("Thinking") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.disabled).toBe(false);
    // The agent's own words, untranslated, because they are the values it validates: `Off` is not German
    // in German, it is what the agent accepts.
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      "The agent's own default",
      "Off",
      "Low",
      "High",
      "Max",
    ]);
    // The empty option is the state a task is in before anybody chooses, and the only way to undo a
    // choice — an id is never empty, so the two cannot be confused.
    expect(picker.value).toBe("");
    expect([...picker.options].map((option) => option.value)).toEqual(["", "off", "low", "high", "max"]);
  });

  it("says the list came from a session, and when, instead of promising it", () => {
    // **The sentence that makes the control honest.** A model or a level an agent lists is per machine
    // and per credential, so this is a record of one session — and the date is what tells a user whether
    // that session was this morning or last month. It is the one thing on this row that a fixed string
    // could not say.
    renderPane([], {
      task: deepseek,
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: false,
    });
    const note = screen.getByText(/thinking levels DeepSeek Harness offered when EnvoyCoder last opened a session/);
    expect(note.textContent).toMatch(/2026/);
    // Not the refusal sentences: nothing here is being refused.
    expect(screen.queryByText(/does not offer a thinking level/)).toBeNull();
    expect(screen.queryByText(/only lists its thinking levels inside a session/)).toBeNull();
  });

  it("sends the chosen level with the first message, so the control is not decorative", () => {
    // The whole point of the row: the value has to travel on `coder.startRun`, which is what the daemon
    // turns into `session/set_config_option`. A picker whose choice is dropped is the bug this control
    // row exists to prevent, and only a test that reads the call can catch it.
    const { onStart } = renderPane([], {
      task: deepseek,
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: false,
    });
    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "max" } });
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "think hard" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // All four arguments, because they are one call: the model this task remembers, no mode
    // (`deepseek-harness` has none), and the level the user just chose.
    expect(onStart).toHaveBeenCalledWith(
      "think hard",
      undefined,
      "deepseek-official/deepseek-v4-flash",
      "max",
    );
  });

  it("remembers the choice on the task, so a run after a restart keeps it", () => {
    const onChangeThinking = vi.fn();
    renderPane([], {
      task: deepseek,
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: false,
      onChangeThinking,
    });
    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "low" } });
    expect(onChangeThinking).toHaveBeenCalledWith("low");

    // And `""` is the request "the agent's own default" — the only way to undo a choice — which must
    // reach the daemon as-is, because the daemon is what drops the stored key instead of saving a level
    // called nothing.
    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "" } });
    expect(onChangeThinking).toHaveBeenLastCalledWith("");
  });

  it("shows the task's stored level as chosen", () => {
    renderPane([], {
      task: { ...deepseek, thinkingLevel: "high" },
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: false,
    });
    expect((screen.getByLabelText("Thinking") as HTMLSelectElement).value).toBe("high");
  });

  it("is off with 'we have not seen a session yet' for the agent that publishes them per session", () => {
    // `deepseek-harness` before its first run, which is the state a fresh install is in. The control is
    // disabled and the sentence is about *our* ignorance, with the one step that would fix it.
    renderPane([], { task: deepseek, harnesses: [harnessFor("deepseek-harness")], runLive: false });

    const picker = screen.getByLabelText("Thinking") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(screen.getByText(/has not opened a session with DeepSeek Harness yet/)).toBeTruthy();
    // Not "it offers none", and not "not wired up yet": three different facts, three sentences.
    expect(screen.queryByText(/does not offer a thinking level/)).toBeNull();
    expect(screen.queryByText(/Choosing how much/)).toBeNull();
  });

  it("is off with 'it offers none' for the agent with no thought-level method", () => {
    // The other disabled state, and the reason both are asserted: `envoy-harness` answers
    // `session/set_config_option` with `-32601 method not found`, verified against the built peer, so
    // there is genuinely nothing to offer and the sentence says so about the agent.
    renderPane([], {
      task: { ...deepseek, harness: "envoy-harness" },
      harnesses: [harnessFor("envoy-harness")],
      runLive: false,
    });
    const picker = screen.getByLabelText("Thinking") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(screen.getByText(/does not offer a thinking level/)).toBeTruthy();
    expect(screen.queryByText(/has not opened a session/)).toBeNull();
  });

  it("says the choice applies to the next run while one is live", () => {
    // The shared property of every control on this row, in its own line: a user who changed only the
    // thinking level must not be told about the folder or the model.
    renderPane([], {
      task: deepseek,
      harnesses: [harnessFor("deepseek-harness", { thinking: LEVELS })],
      runLive: true,
    });
    expect(screen.queryByText(/keeps the thinking level it started with/)).toBeNull();
    expect(screen.queryByText(/keeps the model it started on/)).toBeNull();
    // One line for the run — which is what those two sentences were both saying.
    expect(document.querySelectorAll(".composer__control-note")).toHaveLength(1);
  });
});

/**
 * The model list when it came from a session rather than from the agent's own source.
 *
 * The same sentence as the thinking control's, for the same reason — and the state that closes slice 2's
 * recorded gap: `deepseek-harness` publishes its models only inside a session, so before a run there is a
 * text field and after one there is the list it actually enumerated.
 */
describe("the model control when the list came from a session", () => {
  const observed = {
    kind: "listed" as const,
    options: [
      {
        id: "deepseek-official/deepseek-v4-flash",
        label: "DeepSeek-V4-Flash",
        description: "Fast, efficient, and economical.",
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      },
      {
        id: "deepseek-official/deepseek-v4-pro",
        label: "DeepSeek-V4-Pro",
        provider: "deepseek-official",
        model: "deepseek-v4-pro",
      },
    ],
    observedAt: "2026-09-14T05:23:00.000Z",
    source: "observed",
  };

  it("prefers the published options over the text field, and says where they came from", () => {
    renderPane([], {
      task: { ...task, harness: "deepseek-harness", model: undefined },
      harnesses: [harnessFor("deepseek-harness", { models: observed })],
      runLive: false,
    });

    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      "The agent's own default",
      "DeepSeek-V4-Flash",
      "DeepSeek-V4-Pro",
    ]);
    // The agent's own provider id, decoded from its opaque value — `deepseek-official`, not `deepseek`,
    // which is the name a catalogue list would have got wrong.
    expect([...picker.options][1]?.value).toBe("deepseek-official/deepseek-v4-flash");
    expect(screen.getByText(/models DeepSeek Harness listed when EnvoyCoder last opened a session/)).toBeTruthy();
    // The free-text instruction is gone, because there is no longer a field to type into.
    expect(screen.queryByText(/publishes its models only inside a running session/)).toBeNull();
  });
});

/* ────────────────────────────── the pre-flight probe, on screen ────────────────────────────── */

/**
 * The four states of the probe, rendered.
 *
 * `composer-controls.test.ts` proves the *decision*; this proves the decision reaches the screen and that
 * the pane's own state machine — ask once, keep the answer against the agent, never re-ask on a re-render —
 * behaves. The distinction matters here more than usual: the failure mode being guarded against is a control
 * that looks like it knows something it does not, and only a render can show that.
 */
describe("asking the agent what it offers, before the first run", () => {
  /**
   * What the daemon puts on the wire for one of the two answers that are not a list.
   *
   * Built with `withMessageRef`, which is what `keyed()` wraps on the daemon's side, so the string here is
   * the shape the window actually receives — key marker and all — rather than a hand-written approximation
   * of it.
   */
  const daemonSaid = (key: string, sentence: string, values: Record<string, string | number>): string =>
    withMessageRef(sentence, { key, values });

  it("asks by itself, and says what the ask costs while it runs", async () => {
    let release: (answer: {
      ok: true;
      outcome: "none";
      detail: string;
    }) => void = () => undefined;
    const ask = vi.fn(
      () =>
        new Promise<{ ok: true; outcome: "none"; detail: string }>((resolve) => {
          release = resolve;
        }),
    );

    renderPane([], {
      task: { ...task, harness: "deepseek-harness", model: undefined },
      harnesses: [harnessFor("deepseek-harness")],
      probeSupported: true,
      onProbeAgent: ask,
    });

    // The composer asks without being pressed: the agent publishes its options only inside a session, and
    // making the user find a button for our ignorance is the product rule this row exists to break.
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask).toHaveBeenCalledWith("deepseek-harness", { force: false });

    // **The state the brief names.** While the probe runs there is no list — and the control says *that*,
    // including what it costs, instead of showing an empty picker as if the agent had none.
    expect(screen.getByText(/Asking DeepSeek Harness what it offers/)).toBeTruthy();
    expect(screen.getByText(/starts it, asks, and closes it again/)).toBeTruthy();
    // And the one button on screen is disabled while it runs rather than inviting a second process.
    const button = screen.getByRole("button", { name: /Ask DeepSeek Harness again/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    release({
      ok: true,
      outcome: "none",
      detail: daemonSaid(
        "task.composer.probe.none",
        "DeepSeek Harness answered and published nothing to choose from, so there is still no list here — type a value it documents, or pick one after the first run.",
        { agent: "DeepSeek Harness" },
      ),
    });

    // **A fact about the agent, in the daemon's words, in the user's language.** Rendered through the key
    // the daemon sent — not the English sentence it also sent — which is what keeps a German window German
    // when the sentence came from another process.
    await waitFor(() =>
      expect(
        screen.getByText(/answered and published nothing to choose from, so there is still no list here/),
      ).toBeTruthy(),
    );
    // The second ask is offered, and it is the deliberate one.
    expect(screen.getByRole("button", { name: /Ask DeepSeek Harness again/ })).toBeTruthy();
  });

  it("says it could not ask, and never reports that as the agent publishing nothing", async () => {
    const ask = vi.fn(async () => ({
      ok: false as const,
      message: "The daemon does not know coder.probeSessionOptions.",
      key: "error.daemonTooOld" as const,
      values: { method: "coder.probeSessionOptions" },
    }));

    renderPane([], {
      task: { ...task, harness: "deepseek-harness", model: undefined },
      harnesses: [harnessFor("deepseek-harness")],
      probeSupported: true,
      onProbeAgent: ask,
    });

    // A failed *call* is the same statement to a user as an agent we could not reach, and the refusal
    // already carries its own key — so the window renders it rather than composing a second sentence.
    await waitFor(() => expect(screen.getByText(/daemon.*does not know coder\.probeSessionOptions/)).toBeTruthy());
    expect(screen.queryByText(/answered and published nothing/)).toBeNull();
  });

  it("asks a second time only when pressed, and then with force", async () => {
    const ask = vi.fn(async () => ({
      ok: true as const,
      outcome: "unreachable" as const,
      detail: daemonSaid(
        "task.composer.probe.failed",
        "EnvoyCoder could not ask DeepSeek Harness what it offers: spawn ENOENT Nothing you see has changed.",
        { agent: "DeepSeek Harness", reason: "spawn ENOENT" },
      ),
    }));

    renderPane([], {
      task: { ...task, harness: "deepseek-harness", model: undefined },
      harnesses: [harnessFor("deepseek-harness")],
      probeSupported: true,
      onProbeAgent: ask,
    });

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/could not ask DeepSeek Harness what it offers/)).toBeTruthy();

    // A re-render — the transcript, a keystroke — must not ask again: the answer is already here.
    fireEvent.change(screen.getByLabelText("Message the agent"), { target: { value: "hello" } });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    // The user pressing the button does, and it forces: the daemon's cache must not answer a press.
    fireEvent.click(screen.getByRole("button", { name: /Ask DeepSeek Harness again/ }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask).toHaveBeenLastCalledWith("deepseek-harness", { force: true });
  });

  it("offers nothing to press for an agent whose options the catalogue already answers", async () => {
    const ask = vi.fn();
    renderPane([], {
      // `envoy-harness`: a model list published in its own source, and no thought-level surface at all —
      // so a probe would spend a process to learn nothing, and the pane does not offer one.
      task: { ...task, harness: "envoy-harness" },
      harnesses: [harnessFor("envoy-harness")],
      probeSupported: true,
      onProbeAgent: ask,
    });

    expect(screen.queryByRole("button", { name: /Ask Envoy Harness/ })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("offers nothing either when the daemon is an older build than this window", async () => {
    const ask = vi.fn();
    renderPane([], {
      task: { ...task, harness: "deepseek-harness", model: undefined },
      harnesses: [harnessFor("deepseek-harness")],
      // `coder.hello` did not list the method: this window is attached to a daemon that predates it (the
      // shell attaches to whichever build owns the port). No button, rather than one that comes back
      // "Method not found" — the global version-skew notice is the sentence for that.
      probeSupported: false,
      onProbeAgent: ask,
    });

    expect(screen.queryByRole("button", { name: /Ask DeepSeek Harness/ })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});

// **The pane no longer removes a task, and the two tests that used to live here moved rather than
// died.** The control is the task's own row in the rail (`sidebar.test.tsx`, "a task's row menu"), which
// is the surface the action changes: the row is what leaves. What those two tests encoded — *ask before
// removing, and Cancel removes nothing* — is asserted there, against the same `task.remove.*` copy this
// header used to render. There is deliberately nothing to assert here: a pane that removed a task would
// be a second control for one destructive action, which is the thing the move was made to avoid.
