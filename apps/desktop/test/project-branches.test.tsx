/**
 * The project's branch control: what it shows, what it refuses to show, and what it sends.
 *
 * The three behaviours worth pinning are the ones a reader would otherwise have to trust: a folder git does
 * not track draws **nothing** (and spawns nothing — the stored `vcs.kind` is what makes that free), a
 * detached HEAD is said out loud rather than drawn as a branch with a strange name, and a switch or a create
 * goes through the two calls the daemon exposed — with a refusal rendered in place instead of swallowed.
 */

/** @vitest-environment jsdom */
import type { JSX } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitBranch, GitStatus, Project } from "@envoydev/protocol";

import { ProjectBranches } from "../src/components/ProjectBranches.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { Refusal } from "../src/i18n/notice.js";
import { en } from "../src/i18n/messages/en.js";
import type { GitSnapshot } from "../src/state/coderStore.js";

afterEach(cleanup);

function project(vcs?: Project["vcs"]): Project {
  return {
    id: "proj-1",
    path: "/tmp/repo",
    label: "repo",
    hostId: "local",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...(vcs ? { vcs } : {}),
  };
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    kind: "git",
    branch: "work",
    detached: false,
    ahead: 0,
    behind: 0,
    dirty: 0,
    conflicted: false,
    ...overrides,
  };
}

const BRANCHES: GitBranch[] = [
  { name: "main", current: false },
  { name: "work", current: true },
];

function renderControl(options: {
  project?: Project;
  /** Omit to get a measured `git` snapshot; pass `undefined` explicitly for "nothing measured yet". */
  snapshot?: GitSnapshot | undefined;
  onCheckout?: (branch: string) => Promise<{ ok: true } | Refusal>;
  onCreate?: (name: string) => Promise<{ ok: true } | Refusal>;
  onRead?: () => Promise<{ ok: true }>;
  onMerge?: (branch: string) => Promise<{ ok: true; into?: string } | Refusal>;
  onFetch?: () => Promise<{ ok: true; summary: string } | Refusal>;
  onPull?: () => Promise<{ ok: true; summary: string } | Refusal>;
  onResolve?: (
    branch: string,
  ) => Promise<
    | { ok: true; outcome: "merged"; into?: string }
    | { ok: true; outcome: "resolving"; task: string }
    | Refusal
  >;
  onFinishMerge?: () => Promise<{ ok: true; sha: string } | Refusal>;
  onAbortMerge?: () => Promise<{ ok: true } | Refusal>;
} = {}) {
  const onRead = options.onRead ?? vi.fn(async () => ({ ok: true as const }));
  const onCheckout = options.onCheckout ?? vi.fn(async () => ({ ok: true as const }));
  const onCreate = options.onCreate ?? vi.fn(async () => ({ ok: true as const }));
  const onMerge = options.onMerge ?? vi.fn(async () => ({ ok: true as const }));
  const onFetch = options.onFetch ?? vi.fn(async () => ({ ok: true as const, summary: "" }));
  const onPull = options.onPull ?? vi.fn(async () => ({ ok: true as const, summary: "" }));
  const onResolve = options.onResolve ?? vi.fn(async () => ({ ok: true as const, outcome: "merged" as const }));
  const onFinishMerge = options.onFinishMerge ?? vi.fn(async () => ({ ok: true as const, sha: "abc1234" }));
  const onAbortMerge = options.onAbortMerge ?? vi.fn(async () => ({ ok: true as const }));
  const view = render(
    <I18nProvider preference="en">
      <ProjectBranches
        project={options.project ?? project({ kind: "git" })}
        snapshot={"snapshot" in options ? options.snapshot : { status: status(), branches: BRANCHES }}
        onRead={onRead}
        onCheckout={onCheckout}
        onCreate={onCreate}
        onMerge={onMerge}
        onFetch={onFetch}
        onPull={onPull}
        onResolve={onResolve}
        onFinishMerge={onFinishMerge}
        onAbortMerge={onAbortMerge}
      />
    </I18nProvider>,
  );
  return { ...view, onRead, onCheckout, onCreate, onMerge, onFetch, onPull, onResolve, onFinishMerge, onAbortMerge };
}

const trigger = (): HTMLElement =>
  screen.getByRole("button", { name: en["git.branches.aria"].replace("{project}", "repo") });

describe("ProjectBranches", () => {
  it("draws nothing at all for a folder git does not track", () => {
    // No snapshot and no `vcs.kind === "git"`: nothing to draw, and nothing spawned.
    const { onRead } = renderControl({ project: project({ kind: "none" }), snapshot: undefined });
    expect(screen.queryByRole("button", { name: /Branches for/ })).toBeNull();
    // A rail of ten projects must not spawn git for the nine that are not repositories.
    expect(onRead).not.toHaveBeenCalled();
  });

  it("does not draw for a repository the daemon says is jj", () => {
    render(
      <I18nProvider preference="en">
        <ProjectBranches
          project={project()}
          snapshot={{ status: status({ kind: "jj", branch: undefined }), branches: [] }}
          onRead={vi.fn(async () => ({ ok: true as const }))}
          onCheckout={vi.fn(async () => ({ ok: true as const }))}
          onCreate={vi.fn(async () => ({ ok: true as const }))}
          onMerge={vi.fn(async () => ({ ok: true as const }))}
          onFetch={vi.fn(async () => ({ ok: true as const, summary: "" }))}
          onPull={vi.fn(async () => ({ ok: true as const, summary: "" }))}
          onResolve={vi.fn(async () => ({ ok: true as const, outcome: "merged" as const }))}
          onFinishMerge={vi.fn(async () => ({ ok: true as const, sha: "abc1234" }))}
          onAbortMerge={vi.fn(async () => ({ ok: true as const }))}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: new RegExp(en["git.branches.aria"].replace("{project}", "repo")) })).toBeNull();
  });

  it("measures once per open, not once per render of its caller", async () => {
    /**
     * **Callers pass an inline arrow**, so the read's identity changes whenever the rail re-renders — which
     * happens on any state change anywhere in the window. Depending on the callback would therefore re-run the
     * effect on every one of those renders, and since the read updates the snapshot that renders the caller,
     * that is a spawn loop rather than a re-measure. The ref is what makes "on open" mean once.
     *
     * The re-render has to come from the *caller*: a child that re-renders because of its own state keeps the
     * props object it was given, which is why the first version of this test passed against the bug.
     */
    const onRead = vi.fn(async () => ({ ok: true as const }));
    const tree = (): JSX.Element => (
      <I18nProvider preference="en">
        <ProjectBranches
          project={project({ kind: "git" })}
          snapshot={{ status: status(), branches: BRANCHES }}
          onRead={() => onRead()}
          onCheckout={vi.fn(async () => ({ ok: true as const }))}
          onCreate={vi.fn(async () => ({ ok: true as const }))}
          onMerge={vi.fn(async () => ({ ok: true as const }))}
          onFetch={vi.fn(async () => ({ ok: true as const, summary: "" }))}
          onPull={vi.fn(async () => ({ ok: true as const, summary: "" }))}
          onResolve={vi.fn(async () => ({ ok: true as const, outcome: "merged" as const }))}
          onFinishMerge={vi.fn(async () => ({ ok: true as const, sha: "abc1234" }))}
          onAbortMerge={vi.fn(async () => ({ ok: true as const }))}
        />
      </I18nProvider>
    );
    const { rerender } = render(tree());

    fireEvent.click(trigger());
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    // The rail re-renders: the same panel, handed a fresh callback.
    rerender(tree());
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("shows the branch, and measures once for a project that has no snapshot yet", async () => {
    // The stored `vcs.kind` is what says "worth measuring" — a project added by an older build has none, so
    // a measured snapshot is the other way in.
    const { onRead } = renderControl({ snapshot: undefined });
    expect(trigger().textContent).toContain("…");
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
  });

  it("lists the branches and switches when one is chosen", async () => {
    const onCheckout = vi.fn(async () => ({ ok: true as const }));
    renderControl({ onCheckout });

    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "main" })).toBeTruthy();
    // The branch HEAD is on is marked, and cannot be chosen again.
    expect(screen.getByRole("button", { name: "work" }).getAttribute("aria-current")).toBe("true");
    expect((screen.getByRole("button", { name: "work" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "main" }));
    await waitFor(() => expect(onCheckout).toHaveBeenCalledWith("main"));
    // The list follows the switch when the window hands back a new snapshot — and the row rule is what makes
    // that load-bearing: `current` is both the mark and the *disable*, so a stale list is a locked door.
    expect(screen.getByRole("button", { name: "work" })).toBeTruthy();
    // The panel stays open and says what happened, which is what makes a second switch possible.
    expect(await screen.findByText(en["git.branches.switched"].replace("{branch}", "main"))).toBeTruthy();
  });

  it("creates a branch from the field, and keeps the name it was given", async () => {
    const onCreate = vi.fn(async () => ({ ok: true as const }));
    renderControl({ onCreate });

    fireEvent.click(trigger());
    const field = screen.getByLabelText(en["git.branches.new"]) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "feature/thing" } });
    fireEvent.click(screen.getByRole("button", { name: en["git.branches.create"] }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("feature/thing"));
    expect(await screen.findByText(en["git.branches.created"].replace("{branch}", "feature/thing"))).toBeTruthy();
    expect(field.value).toBe("");
  });

  it("renders a refusal in place rather than swallowing it", async () => {
    renderControl({
      onCreate: async () => ({
        ok: false,
        message: '"a..b" cannot be a branch name.',
        key: "error.gitBranchInvalid",
        values: { name: "a..b" },
      }),
    });

    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText(en["git.branches.new"]), { target: { value: "a..b" } });
    fireEvent.click(screen.getByRole("button", { name: en["git.branches.create"] }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("a..b");
    expect(alert.textContent).not.toContain("envoydev.");
  });

  it("says a detached HEAD out loud, in the chip and in the panel", () => {
    renderControl({
      snapshot: { status: status({ branch: undefined, detached: true }), branches: [BRANCHES[0]!] },
    });
    expect(trigger().textContent).toContain(en["git.branches.detachedChip"]);

    fireEvent.click(trigger());
    expect(screen.getByText(en["git.branches.detached"])).toBeTruthy();
  });

  it("closes on Escape and gives focus back to the chip", async () => {
    renderControl();
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("merges a branch into the one the project is on", async () => {
    const onMerge = vi.fn(async () => ({ ok: true as const, into: "work" }));
    renderControl({ onMerge });

    fireEvent.click(trigger());
    // The merge is offered on the branch you would merge *from*, and names where it lands.
    fireEvent.click(screen.getByRole("button", { name: "Merge main into work" }));

    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("main"));
    expect(await screen.findByText("Merged main into work.")).toBeTruthy();
  });

  it("renders a conflicted merge in place, with the files", async () => {
    // A merge that cannot be finished happens *here*, next to the list it was started from — and says the
    // repository was left alone, because that is the promise the daemon keeps.
    renderControl({
      onMerge: async () => ({
        ok: false,
        message: "work cannot be merged automatically. These files conflict: a.txt.",
        key: "error.gitMergeConflict",
        values: { branch: "work", files: "a.txt" },
      }),
    });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Merge main into work" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("a.txt");
    expect(alert.textContent).not.toContain("envoydev.");
  });

  it("fetches and pulls, and says when there was nothing to bring", async () => {
    const onFetch = vi.fn(async () => ({ ok: true as const, summary: "" }));
    const onPull = vi.fn(async () => ({ ok: true as const, summary: "Fast-forward  a.txt | 1 +" }));
    renderControl({ onFetch, onPull });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(onFetch).toHaveBeenCalled());
    // **An empty summary is git saying nothing changed** — a fact, said in the user's language rather than
    // left as an empty sentence after "Fetched.".
    expect(await screen.findByText(en["git.fetch.nothing"])).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => expect(onPull).toHaveBeenCalled());
    // A regex, because git's own summary is column-aligned and its whitespace is not the assertion.
    expect(await screen.findByText(/Pulled\. Fast-forward\s+a\.txt/)).toBeTruthy();
  });

  it("shows a diverged pull as a choice rather than a failure", async () => {
    renderControl({
      onPull: async () => ({
        ok: false,
        message: "The branch on the computer and the one on the remote have both changed.",
        key: "error.gitPullDiverged",
      }),
    });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("both changed");
  });
});

describe("a merge that stops on conflicts", () => {
  it("offers to resolve it with an agent, naming the branch that conflicted", async () => {
    const onMerge = vi.fn(
      async (): Promise<{ ok: false; message: string; key: string } & Refusal> => ({
        ok: false as const,
        message: "work cannot be merged automatically.",
        key: "error.gitMergeConflict",
      }),
    );
    const onResolve = vi.fn(async () => ({
      ok: true as const,
      outcome: "resolving" as const,
      task: "Resolve the merge of main",
    }));
    renderControl({ onMerge, onResolve });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: en["git.merge.into"].replace("{branch}", "main").replace("{current}", "work") }));

    // The refusal is the daemon's sentence, and the act that follows from it is beside it.
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["git.merge.resolve"] }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("main"));
    // The notice names the task, which is how a user finds the run in the rail.
    expect(
      await screen.findByText(en["git.merge.resolving"].replace("{task}", "Resolve the merge of main")),
    ).toBeTruthy();
  });

  it("says a merge that needed no agent merged, rather than claiming one is working", async () => {
    const onMerge = vi.fn(
      async (): Promise<{ ok: false; message: string; key: string } & Refusal> => ({
        ok: false as const,
        message: "conflict",
        key: "error.gitMergeConflict",
      }),
    );
    const onResolve = vi.fn(async () => ({ ok: true as const, outcome: "merged" as const, into: "work" }));
    const { onResolve: _never } = renderControl({ onMerge, onResolve });
    void _never;

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: en["git.merge.into"].replace("{branch}", "main").replace("{current}", "work") }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: en["git.merge.resolve"] }));

    expect(await screen.findByText(en["git.merge.done"].replace("{branch}", "main").replace("{into}", "work"))).toBeTruthy();
  });

  it("reports a merge in progress, and takes it back when asked", async () => {
    const onAbortMerge = vi.fn(async () => ({ ok: true as const }));
    renderControl({
      snapshot: {
        status: status({ conflicted: true, dirty: 1, merge: { branch: "main" } }),
        branches: BRANCHES,
      },
      onAbortMerge,
    });

    // The chip says what the state *is*, and its title still names the branch.
    expect(trigger().textContent).toContain(en["git.branches.conflictsChip"]);
    expect(trigger().getAttribute("title")).toBe(en["sidebar.project.branch"].replace("{branch}", "work"));

    fireEvent.click(trigger());
    expect(screen.getByText(en["git.merge.stoppedFrom"].replace("{branch}", "main"))).toBeTruthy();
    // Finish is not offered while files are still in conflict — the daemon would refuse it.
    expect((screen.getByRole("button", { name: en["git.merge.finish"] }) as HTMLButtonElement).disabled).toBe(true);
    // And the branch list still reads as branches: a chip word must not leak into a merge sentence.
    expect(screen.getByRole("button", { name: en["git.merge.into"].replace("{branch}", "main").replace("{current}", "work") })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: en["git.merge.abort"] }));
    await waitFor(() => expect(onAbortMerge).toHaveBeenCalled());
    expect(await screen.findByText(en["git.merge.aborted"])).toBeTruthy();
  });

  it("offers no branch-moving action while a merge is open, resolved or not", async () => {
    // Two reviewers measured this independently: with every conflict staged, git allows `checkout -b`,
    // `checkout` and `stash push` — and each deletes `MERGE_HEAD`, discarding the resolution nobody has
    // recorded. The daemon refuses them; the panel must not offer them either.
    renderControl({
      snapshot: {
        status: status({ conflicted: false, dirty: 1, merge: { branch: "main" } }),
        branches: BRANCHES,
      },
    });
    fireEvent.click(trigger());

    expect((screen.getByRole("button", { name: "main" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: en["git.merge.into"].replace("{branch}", "main").replace("{current}", "work") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: en["git.pull.cta"] }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: en["git.branches.create"] }) as HTMLButtonElement).disabled).toBe(true);
    // …and Fetch is still live, because it moves nothing in the working tree.
    expect((screen.getByRole("button", { name: en["git.fetch.cta"] }) as HTMLButtonElement).disabled).toBe(false);
    // The way out is the one control that is offered.
    expect((screen.getByRole("button", { name: en["git.merge.finish"] }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("finishes a merge once every conflict is staged", async () => {
    const onFinishMerge = vi.fn(async () => ({ ok: true as const, sha: "abc1234" }));
    renderControl({
      snapshot: {
        status: status({ conflicted: false, dirty: 1, merge: { branch: "main" } }),
        branches: BRANCHES,
      },
      onFinishMerge,
    });

    fireEvent.click(trigger());
    expect(screen.getByText(en["git.merge.resolved"])).toBeTruthy();
    const finish = screen.getByRole("button", { name: en["git.merge.finish"] }) as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);

    await waitFor(() => expect(onFinishMerge).toHaveBeenCalled());
    expect(await screen.findByText(en["git.merge.recorded"])).toBeTruthy();
  });

  it("says a merge stopped without naming a branch git could not name", async () => {
    // `name-rev` answers nothing for a commit no ref reaches, and a sentence with an empty name in it is worse
    // than one without a name at all.
    renderControl({
      snapshot: { status: status({ conflicted: true, dirty: 1, merge: {} }), branches: BRANCHES },
    });
    fireEvent.click(trigger());
    expect(screen.getByText(en["git.merge.stopped"])).toBeTruthy();
  });
});
