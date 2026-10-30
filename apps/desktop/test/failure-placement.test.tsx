/**
 * **Where a refused press is read** — toast for rail/composer; in-place for palette/settings; never a sticky banner.
 *
 * ## The report this file answers
 *
 * The owner pressed **Add** in the catalogue and the window answered with a strip across the top that was
 * ugly and useless. Writes must not raise a window banner. Sticky composer/rail failure lines also stuck
 * forever — those are gone too. Rail and composer refusals toast; settings/palette keep in-place sinks.
 *
 * ## The rule
 *
 * * **A write raises no banner.** `mutate` returns the refusal; the shell toasts rail/composer failures and
 *   keeps settings/palette in-place.
 * * **A window read toasts, not a strip.** `state.error` still holds skew/load failures for empty-state
 *   copy; the shell toasts once and paints **no** `.banner`.
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
import { dismissShellToast } from "../src/state/shell-toast.js";

afterEach(() => {
  cleanup();
  dismissShellToast();
});

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
    openTaskHistory: vi.fn(async () => undefined),
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

const banner = (): HTMLElement | null => document.querySelector(".banner");
const toast = (): HTMLElement | null => document.querySelector('[data-testid="shell-toast"]');

/**
 * **How many times the daemon's sentence is on screen.**
 *
 * One press should answer once (toast or in-place), never doubled with a banner.
 */
const timesOnScreen = (): number => (document.body.textContent ?? "").split(REFUSED).length - 1;

describe("a refused press is read without a sticky strip", () => {
  it("toasts a rail row's refusal, and not in a window banner", async () => {
    show();
    fireEvent.click(screen.getByTitle(en["sidebar.project.newTask.title"].replace("{project}", "api")));

    await waitFor(() => expect(toast()?.textContent).toContain(REFUSED));
    expect(document.querySelector(".sidebar__failure")).toBeNull();
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("toasts a refused send, and not under the composer as a sticky line", async () => {
    show({ tasks: [task], runs: { "run-1": { run: runFixture(), events: [] } } });
    fireEvent.click(screen.getByText(task.title));
    const box = screen.getByLabelText(en["task.composer.aria"]);
    fireEvent.change(box, { target: { value: "and make it idempotent" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));

    await waitFor(() => expect(toast()?.textContent).toContain(REFUSED));
    expect(document.querySelector(".composer__notice")).toBeNull();
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("keeps the palette open on a refusal, and says it in the palette", async () => {
    const onClose = vi.fn();
    show();

    const mac = /mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`);
    fireEvent.keyDown(window, { key: "k", metaKey: mac, ctrlKey: !mac });
    fireEvent.click(screen.getByText(en["palette.addProject.title"]));

    const field = screen.getByPlaceholderText(en["palette.addProject.needsPlaceholder"]);
    fireEvent.change(field, { target: { value: "/nope/nowhere" } });
    const stageRow = document.querySelector(".palette__stage-row") as HTMLElement;
    fireEvent.click(
      within(stageRow).getByRole("button", { name: en["palette.addProject.title"].replace("…", "") }),
    );

    await waitFor(() => expect(document.querySelector(".palette__status")).toBeTruthy());
    expect(document.querySelector(".palette__status")?.textContent).toBe(REFUSED);
    expect(screen.getByRole("dialog", { name: en["palette.title"] })).toBeTruthy();
    expect((screen.getByPlaceholderText(en["palette.addProject.needsPlaceholder"]) as HTMLInputElement).value).toBe(
      "/nope/nowhere",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("shows a settings row's refusal under that row, and not in the window's bar", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: en["sidebar.settings"] }));
    const select = screen.getByLabelText(en["settings.language.aria"]);
    fireEvent.change(select, { target: { value: "de" } });

    await waitFor(() => expect(document.querySelector(".setting__failure")).toBeTruthy());
    expect(document.querySelector(".setting__failure")?.textContent).toBe(REFUSED);
    expect(document.querySelectorAll(".setting__failure")).toHaveLength(1);
    expect(document.querySelector(".setting__failure")?.closest(".setting")?.textContent).toContain(
      en["settings.language.title"],
    );
    expect(timesOnScreen()).toBe(1);
    expect(banner()).toBeNull();
  });

  it("does not leave a sticky composer notice when switching tasks after a refused send", async () => {
    show({
      tasks: [task, otherTask],
      runs: { "run-1": { run: runFixture(), events: [] } },
    });
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });

    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));
    await waitFor(() => expect(toast()?.textContent).toContain(REFUSED));
    expect(document.querySelector(".composer__notice")).toBeNull();

    fireEvent.click(screen.getByText(otherTask.title));
    expect(document.querySelector(".composer__notice")).toBeNull();
    expect(banner()).toBeNull();
  });

  it("says nothing in the title bar about how many windows are attached", () => {
    show({ hello: { ...HELLO, windowCount: 4 } });
    expect(document.querySelector(".titlebar")?.textContent ?? "").not.toContain("4 window");
    expect(document.body.textContent ?? "").not.toContain("windows");
  });

  it("shows the app's own logo in the top bar, beside the name", () => {
    show();
    const logo = document.querySelector("img.titlebar__logo") as HTMLImageElement | null;
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.getAttribute("width")).toBe("18");
    expect(logo?.getAttribute("src") ?? "").not.toBe("");
  });

  it("starts a new run when the task's run is one this window has never heard of", async () => {
    const actions = refusingStore();
    show({ tasks: [task], runs: {} }, actions);
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.start"] }));

    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    expect(actions.sendToRun).not.toHaveBeenCalled();
  });

  it("offers the send action while the run it is showing is genuinely live", async () => {
    const actions = refusingStore();
    show({ tasks: [task], runs: { "run-1": { run: runFixture(), events: [] } } }, actions);
    fireEvent.click(screen.getByText(task.title));
    fireEvent.change(screen.getByLabelText(en["task.composer.aria"]), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: en["task.composer.send"] }));

    await waitFor(() => expect(actions.sendToRun).toHaveBeenCalled());
    expect(actions.startRun).not.toHaveBeenCalled();
  });

  it("keeps a rail toggle out of the window", () => {
    show();
    const titlebar = document.querySelector(".titlebar") as HTMLElement;
    expect(titlebar.querySelectorAll("button")).toHaveLength(1);
    expect(titlebar.querySelector("button")?.getAttribute("aria-label")).toBe(en["explorer.toggle"]);
    expect(titlebar.textContent ?? "").not.toContain("▤");
    expect(screen.getByRole("button", { name: en["sidebar.pair"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: en["sidebar.settings"] })).toBeTruthy();
    expect(screen.getByTestId("sidebar-theme-toggle")).toBeTruthy();

    const mac = /mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`);
    fireEvent.keyDown(window, { key: "k", metaKey: mac, ctrlKey: !mac });
    expect(screen.queryByText("Toggle the project rail")).toBeNull();
  });

  it("toasts what the *window* could not do — no sticky banner", async () => {
    const skew =
      en["error.daemonTooOld"].replace("{method}", "coder.listTasks");
    show({
      error: {
        message: "The daemon does not know coder.listTasks.",
        key: "error.daemonTooOld",
        values: { method: "coder.listTasks" },
      },
    });
    await waitFor(() => expect(toast()?.textContent).toContain(skew));
    expect(banner()).toBeNull();
    expect(within(toast() as HTMLElement).getByRole("button", { name: en["notice.dismiss"] })).toBeTruthy();
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
