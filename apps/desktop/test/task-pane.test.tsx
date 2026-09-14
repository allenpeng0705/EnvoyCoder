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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project, RunEvent, Task } from "@envoycoder/protocol";

import { TaskPane } from "../src/components/TaskPane.js";

// Testing-library only auto-cleans when vitest globals are on, which this repo does not use.
afterEach(cleanup);

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
    expect(pane.onStart).toHaveBeenCalledWith("bump the SDK");
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
