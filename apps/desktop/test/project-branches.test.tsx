/**
 * The project's branch control: what it shows, what it refuses to show, and what it sends.
 *
 * The three behaviours worth pinning are the ones a reader would otherwise have to trust: a folder git does
 * not track draws **nothing** (and spawns nothing — the stored `vcs.kind` is what makes that free), a
 * detached HEAD is said out loud rather than drawn as a branch with a strange name, and a switch or a create
 * goes through the two calls the daemon exposed — with a refusal rendered in place instead of swallowed.
 */

/** @vitest-environment jsdom */
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
} = {}) {
  const onRead = options.onRead ?? vi.fn(async () => ({ ok: true as const }));
  const onCheckout = options.onCheckout ?? vi.fn(async () => ({ ok: true as const }));
  const onCreate = options.onCreate ?? vi.fn(async () => ({ ok: true as const }));
  const onMerge = options.onMerge ?? vi.fn(async () => ({ ok: true as const }));
  const onFetch = options.onFetch ?? vi.fn(async () => ({ ok: true as const, summary: "" }));
  const onPull = options.onPull ?? vi.fn(async () => ({ ok: true as const, summary: "" }));
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
      />
    </I18nProvider>,
  );
  return { ...view, onRead, onCheckout, onCreate, onMerge, onFetch, onPull };
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
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: new RegExp(en["git.branches.aria"].replace("{project}", "repo")) })).toBeNull();
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
