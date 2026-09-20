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
  onCheckout?: (branch: string) => Promise<{ ok: true } | { ok: false; key: string; values?: Record<string, unknown> }>;
  onCreate?: (name: string) => Promise<{ ok: true } | { ok: false; key: string; values?: Record<string, unknown> }>;
  onRead?: () => Promise<{ ok: true }>;
} = {}) {
  const onRead = options.onRead ?? vi.fn(async () => ({ ok: true as const }));
  const onCheckout = options.onCheckout ?? vi.fn(async () => ({ ok: true as const }));
  const onCreate = options.onCreate ?? vi.fn(async () => ({ ok: true as const }));
  const view = render(
    <I18nProvider locale="en">
      <ProjectBranches
        project={options.project ?? project({ kind: "git" })}
        snapshot={"snapshot" in options ? options.snapshot : { status: status(), branches: BRANCHES }}
        onRead={onRead}
        onCheckout={onCheckout}
        onCreate={onCreate}
      />
    </I18nProvider>,
  );
  return { ...view, onRead, onCheckout, onCreate };
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
      <I18nProvider locale="en">
        <ProjectBranches
          project={project()}
          snapshot={{ status: status({ kind: "jj", branch: undefined }), branches: [] }}
          onRead={vi.fn(async () => ({ ok: true as const }))}
          onCheckout={vi.fn(async () => ({ ok: true as const }))}
          onCreate={vi.fn(async () => ({ ok: true as const }))}
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
      onCreate: async () => ({ ok: false, key: "error.gitBranchInvalid", values: { name: "a..b" } }),
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
});
