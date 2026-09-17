/**
 * **Where a refused press is read** — the row, the composer, the palette; never the bar above the window.
 *
 * ## The report this file answers
 *
 * The owner pressed **Add** in the catalogue and the window answered with a strip across the top:
 *
 * > *"After clicking 'Add', it will show the top bar which is ugly and usless, show like 'coder.addProvider was
 * > given a provider this build cannot store: …'"*
 *
 * The strip was right about the sentence and wrong about the place. `CoderStore.mutate` stored every write's
 * refusal in `state.error`, which the shell rendered above every surface, so a press that had **already** said
 * the same thing on its own row said it twice — and the copy nobody could use was the one in the bar: it names no
 * control, it pushes the window down, and it has to be dismissed before the user can get on with what they were
 * doing.
 *
 * ## The rule, and the two halves of it
 *
 * * **A write raises nothing.** `mutate` returns the refusal; the caller renders it where the press was. This file
 *   walks each surface that has one and asserts both halves at once: the sentence is on screen **at the press**,
 *   and the window's banner is **absent** for it.
 * * **A read still does.** `state.error` keeps what the *window* could not do — a list it could not read, a daemon
 *   this build cannot talk to — because that is not about a control and has no row to live in. The last case
 *   asserts that boundary, so "no banner for a press" cannot quietly become "no banner at all", which would take
 *   the build-skew advice off the screen.
 *
 * ## Why the whole shell, rather than each component alone
 *
 * The routing is the thing that broke: the pane's own notice prop existed and **nothing ever passed it**
 * (`notice={` appeared nowhere in the source), and the palette's `status` prop was in the same condition. A
 * component test of `TaskPane` would have passed the whole time the failure was going into the strip. So every
 * case below drives the real `CoderApp` with a store that refuses the one call it is about, and reads the DOM a
 * user would read.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project, Task } from "@envoydev/protocol";

import { CoderApp } from "../src/components/CoderApp.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";
import type { CoderStore } from "../src/state/coderStore.js";
import type { CoderState } from "../src/state/coderStore.js";

afterEach(cleanup);

/** The daemon's sentence, as a refusal. Deliberately unlike any catalogue string: it must be *the wire's*. */
const REFUSED = "envoydev.no-space: there is no space left on the device";

const project: Project = {
  id: "local::/work/api",
  path: "/work/api",
  label: "api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

const task: Task = {
  id: "t1",
  projectId: project.id,
  cwd: project.path,
  title: "write the parser",
  harness: "envoy-harness",
  status: "running",
  createdAt: "2026-09-01T09:05:00.000Z",
  updatedAt: "2026-09-01T09:06:00.000Z",
  runId: "run-1",
};

const otherTask: Task = {
  id: "t2",
  projectId: project.id,
  cwd: project.path,
  title: "the other one",
  harness: "envoy-harness",
  status: "idle",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

/** The daemon's own handshake, with a window count a titlebar badge would have shown. */
const HELLO = {
  product: "EnvoyDev",
  version: "0.1.0",
  instanceId: "test",
  home: "/home/you/.envoymesh",
  stateDir: "/home/you/.envoymesh/EnvoyDev",
  startedAt: "2026-09-14T00:00:00.000Z",
  windowCount: 1,
  methods: [],
  mesh: { kind: "no-node" as const },
  notes: [],
};

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: undefined,
    projects: [project],
    tasks: [task],
    tasksKnown: true,
    settings,
    harnesses: [],
    providers: [],
    catalog: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

/** A store whose writes all refuse, so any press in the window produces the same sentence. */
function refusingStore(over: Record<string, unknown> = {}): CoderStore {
  const refuse = (): ReturnType<typeof vi.fn> => vi.fn(async () => ({ ok: false as const, message: REFUSED }));
  return {
    createTask: refuse(),
    startRun: refuse(),
    updateTask: refuse(),
    updateSettings: refuse(),
    updateProject: refuse(),
    addProject: refuse(),
    archiveTask: refuse(),
    removeProject: refuse(),
    sendToRun: refuse(),
    cancelRun: refuse(),
    answerApproval: refuse(),
    // The shell asks about the run a pane is showing; a double that did not answer would throw in an effect.
    openRun: vi.fn(async () => undefined),
    clearError: vi.fn(),
    ...over,
  } as unknown as CoderStore;
}

function show(over: Partial<CoderState> = {}, actions: CoderStore = refusingStore()): void {
  render(
    <I18nProvider preference="en">
      <CoderApp state={stateWith(over)} actions={actions} />
    </I18nProvider>,
  );
}

/** The bar above every surface — the thing a refused press must never reach. */
const banner = (): HTMLElement | null => document.querySelector(".banner");

/**
 * **How many times the daemon's sentence is on screen.**
 *
 * The owner's complaint was not that the strip said something wrong — it was that the strip said it *as well*, so
 * one press answered twice and the copy nobody could use was the one at the top of the window. A count is the
 * assertion that can see that: `1` for a press whose failure is read where it was made, whatever the surface.
 */
const timesOnScreen = (): number => (document.body.textContent ?? "").split(REFUSED).length - 1;

describe("a refused press is read where it was made", () => {
  it("shows a rail row's refusal under that row, and not in the window's bar", async () => {
    // "+ New" on a project header is the shortest real press in the rail: the shell creates the task, the
    // daemon refuses, and the sentence belongs to *that project's* row — which is the row the button is on.
    show();
    fireEvent.click(screen.getByTitle(en["sidebar.project.newTask.title"].replace("{project}", "api")));

    await waitFor(() => expect(document.querySelector(".sidebar__failure")).toBeTruthy());
    expect(document.querySelector(".sidebar__failure")?.textContent).toBe(REFUSED);
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("shows a refused send under the composer, and not in the window's bar", async () => {
    show({ tasks: [task], runs: { "run-1": { run: runFixture(), events: [] } } });
    fireEvent.click(screen.getByText(task.title));
    const box = screen.getByLabelText(en["task.composer.aria"]);
    fireEvent.change(box, { target: { value: "and make it idempotent" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));

    // The composer's own line — the `notice` prop that existed and that nothing passed until this change.
    await waitFor(() => expect(document.querySelector(".composer__notice")).toBeTruthy());
    expect(document.querySelector(".composer__notice")?.textContent).toBe(REFUSED);
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("keeps the palette open on a refusal, and says it in the palette", async () => {
    // The other half of the same defect: the palette used to close and hand its failure to the strip, so the
    // user lost the field they had typed the bad path into. `run` answers now, and the palette decides.
    const onClose = vi.fn();
    show();

    // ⌘K is the shell's own binding; the titlebar carries the same action as a button.
    fireEvent.click(screen.getByRole("button", { name: en["palette.title"] }));
    fireEvent.click(screen.getByText(en["palette.addProject.title"]));

    // The placeholder rather than the label: in a window with no shell the stage appends *why* there is no
    // folder chooser to the label, and a test that pinned the bare label would be testing jsdom's picker.
    const field = screen.getByPlaceholderText(en["palette.addProject.needsPlaceholder"]);
    fireEvent.change(field, { target: { value: "/nope/nowhere" } });
    // The stage's own confirm, inside the stage row: the *row* carries almost the same accessible name
    // ("Add project…"), and pressing the row would re-stage rather than run.
    const stageRow = document.querySelector(".palette__stage-row") as HTMLElement;
    fireEvent.click(
      within(stageRow).getByRole("button", { name: en["palette.addProject.title"].replace("…", "") }),
    );

    await waitFor(() => expect(document.querySelector(".palette__status")).toBeTruthy());
    expect(document.querySelector(".palette__status")?.textContent).toBe(REFUSED);
    // Still open, with what was typed still in the field: the user can correct it and press again.
    expect(screen.getByRole("dialog", { name: en["palette.title"] })).toBeTruthy();
    expect((screen.getByPlaceholderText(en["palette.addProject.needsPlaceholder"]) as HTMLInputElement).value).toBe(
      "/nope/nowhere",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("shows a settings row's refusal under that row, and not in the window's bar", async () => {
    // A settings write is the case with no row of its own in the store's answer: the patch says what changed,
    // not which control asked. `SettingRow` owns the sink, so the sentence lands under the control that wrote.
    show();
    fireEvent.click(screen.getByRole("button", { name: en["sidebar.footer.settings"] }));
    const select = screen.getByLabelText(en["settings.language.aria"]);
    fireEvent.change(select, { target: { value: "de" } });

    await waitFor(() => expect(document.querySelector(".setting__failure")).toBeTruthy());
    expect(document.querySelector(".setting__failure")?.textContent).toBe(REFUSED);
    // Under the row that wrote, not under some other row on the page.
    expect(document.querySelectorAll(".setting__failure")).toHaveLength(1);
    expect(document.querySelector(".setting__failure")?.closest(".setting")?.textContent).toContain(
      en["settings.language.title"],
    );
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("does not carry one task's failure into another task's chat", async () => {
    // A pane-level slot would: the failure is about a press in *this* task's composer, and showing it to a user
    // who has since opened a different task is a sentence about work they are not looking at.
    show({
      tasks: [task, otherTask],
      runs: { "run-1": { run: runFixture(), events: [] } },
    });
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });

    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));
    await waitFor(() => expect(document.querySelector(".composer__notice")).toBeTruthy());

    // Switch to the other task: the rail's own row.
    fireEvent.click(screen.getByText(otherTask.title));
    expect(document.querySelector(".composer__notice")).toBeNull();
    expect(timesOnScreen()).toBe(0);
    expect(banner()).toBeNull();
  });

  it("says nothing in the title bar about how many windows are attached", () => {
    // **Where the owner's question came from.** A chip used to stand in the title bar reading
    // `hello.windowCount`, and it said "2 windows" for one window — because the window opened two sockets
    // (`coder-store.test.ts`, "one window, one socket"). The badge is gone rather than half-fixed: the number is a
    // **snapshot from connect time**, so it can never correct itself when a second window opens or closes, and a
    // claim in the chrome that contradicts the truth is the class of thing this repository refuses. The count is
    // still on *Settings → This machine*, where the row says which moment it was read.
    show({ hello: { ...HELLO, windowCount: 4 } });
    expect(document.querySelector(".titlebar")?.textContent ?? "").not.toContain("4 window");
    expect(document.body.textContent ?? "").not.toContain("windows");
  });

  it("shows the app's own logo in the top bar, beside the name", () => {
    // The mark the product ships (`apps/desktop/assets/logo.png`), rendered at 18px from the 128px copy — a window
    // should not decode a megabyte for a slot this size. Decorative, because the name is right beside it: a screen
    // reader that read both would say the product twice.
    show();
    const logo = document.querySelector("img.titlebar__logo") as HTMLImageElement | null;
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.getAttribute("width")).toBe("18");
    // It is bundled by Vite rather than linked from a path on disk, which is what makes it survive `tauri build`.
    expect(logo?.getAttribute("src") ?? "").not.toBe("");
  });

  it("starts a new run when the task's run is one this window has never heard of", async () => {
    // **The owner's report, exactly.** A task carries a `runId` from a daemon that has since restarted, so the
    // window has no record of that run — and `runLive` used to read `state.runs[runId]?.run.endedAt === undefined`,
    // which is **true** when the record is absent. The composer therefore queued the message behind a run that does
    // not exist, the daemon answered *"That run has already finished…"*, and the field was cleared on the way out.
    //
    // With the record required for "live", the press is a *start*: the daemon's `startRun` is the thing that can
    // honour it, and the old run id is not sent anywhere.
    const actions = refusingStore();
    show({ tasks: [task], runs: {} }, actions);
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.start"] }));

    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    expect(actions.sendToRun).not.toHaveBeenCalled();
  });

  it("offers the send action while the run it is showing is genuinely live", async () => {
    // The other direction, so "unknown is not running" cannot become "nothing is ever running".
    const actions = refusingStore();
    show({ tasks: [task], runs: { "run-1": { run: runFixture(), events: [] } } }, actions);
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));

    await waitFor(() => expect(actions.sendToRun).toHaveBeenCalled());
    expect(actions.startRun).not.toHaveBeenCalled();
  });

  it("keeps the rail's toggle out of the top bar, and reachable from the palette", () => {
    // **Removing a control is only honest if the capability survives it.** The owner asked for the button left of
    // the app logo to go; the rail is not stranded, because the command palette carries the same action as a row
    // and `⌘B` is bound to it (`input/shortcuts.ts`, listed on Settings → Keyboard shortcuts).
    show();
    const titlebar = document.querySelector(".titlebar") as HTMLElement;
    expect(titlebar.querySelectorAll("button")).toHaveLength(1);
    expect(titlebar.textContent ?? "").not.toContain("▤");

    // …and the row is still there, in the palette the window opens with its own button.
    fireEvent.click(screen.getByRole("button", { name: en["palette.title"] }));
    expect(screen.getByText(en["palette.toggleRail.title"])).toBeTruthy();
  });

  it("still raises the bar for what the *window* could not do", () => {
    // The boundary. A read that failed is not about a control and has no row to live in, so it keeps the bar —
    // and `error.daemonTooOld` is the case that must never become silent, because the fix it names is a restart.
    show({ error: { message: "The daemon does not know coder.listTasks.", key: "error.daemonTooOld", values: { method: "coder.listTasks" } } });
    expect(banner()?.textContent).toContain(en["error.daemonTooOld"].replace("{method}", "coder.listTasks"));
    expect(within(banner() as HTMLElement).getByRole("button", { name: en["notice.dismiss"] })).toBeTruthy();
  });
});

function runFixture(): NonNullable<CoderState["runs"][string]>["run"] {
  return {
    id: "run-1",
    taskId: task.id,
    harness: "envoy-harness",
    hostId: "local",
    startedAt: "2026-09-01T09:06:00.000Z",
    status: "running",
  };
}
