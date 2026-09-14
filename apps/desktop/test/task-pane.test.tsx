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

import { canApplyModel, harnessModels } from "@envoycoder/agent-catalog";

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
    capabilities,
    available: true,
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
 *   3. **Both say "next run" while one is running.** The agent is launched with `task.cwd` and put into
 *      its mode right after `session/new`, so neither control can move or re-mode a run already going —
 *      and pretending otherwise is how a user concludes the app ignored them.
 */
describe("the folder control", () => {
  const nested = { ...task, cwd: "/repo/packages/api" };

  it("shows the folder relative to the project, with the whole path in the title", () => {
    renderPane([], { task: nested });
    const pill = screen.getByLabelText("Change this task's folder");
    // Relative, because that is the shape a user recognises: the project is already named in the header.
    expect(pill.textContent).toBe("packages/api");
    // Nothing is hidden: the full path is one hover away.
    expect(pill.getAttribute("title")).toBe("/repo/packages/api");
  });

  it("is disabled with the reason shown when this window has no chooser", () => {
    // A browser dev server, or Linux without zenity. A button that silently does nothing is worse than
    // one that says why it cannot.
    renderPane([], { task: nested, onChangeFolder: vi.fn() });
    const pill = screen.getByLabelText("Change this task's folder") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
    expect(screen.getByText(/no folder chooser/i)).toBeTruthy();
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

  it("tells the user the change applies to the next run while one is live", () => {
    lendShell(async () => null);
    renderPane([], { task: nested, runLive: true, onChangeFolder: vi.fn() });
    // Not a disabled control: the choice is real and will be used. It is the *running* agent that keeps
    // the directory it started in, and the sentence has to say so.
    expect(screen.getByText(/still working in \/repo\/packages\/api/)).toBeTruthy();
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

    expect(onStart).toHaveBeenCalledWith("plan it out", "plan", "deepseek-official/deepseek-v4-flash");
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
    );
  });

  it("tells the user the mode applies to the next run while one is live", () => {
    renderPane([], { task: envoyTask, runLive: true, harnesses: [harnessFor("envoy-harness")] });
    expect(screen.getByText(/keeps the mode it started with/)).toBeTruthy();
    // The folder's sentence is its own, and this is a mode-only change: one control's note must not
    // be stretched to cover the other, or a user reads a warning about something they never touched.
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
    expect(screen.getByText(/publishes its models only inside a running session/)).toBeTruthy();
    // Both facts at once, because they are not alternatives: the instruction is about the value's
    // shape, the note below it about when the choice takes effect.
    expect(screen.getByText(/keeps the model it started on/)).toBeTruthy();
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
    // `--provider`/`--model` (envoy-harness) or the session config (deepseek-harness).
    expect(onStart).toHaveBeenCalledWith("use sonnet", "default", "anthropic/claude-sonnet-4-6");
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
