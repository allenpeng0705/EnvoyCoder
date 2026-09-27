/**
 * Job step templates — sequential pipelines vs parallel fan-out (§5.3).
 *
 * EnvoyDev schedules order (`dependsOn`) and folder locks (`worktreeKey`).
 * Git pull/commit stays in each step’s brief for the agent to honour.
 */

import type { Job, JobRole } from "@envoydev/protocol";

/** Same shape as `JobStepDraft` in `jobs.ts` — kept local to avoid a cycle. */
export type TemplateStepDraft = {
  id?: string;
  role: JobRole;
  brief: string;
  worktreeKey: string;
  cwdHint: string;
  dependsOn?: readonly string[];
};

export type JobStepTemplateId =
  | "pipeline"
  | "parallel-feature"
  | "parallel-test"
  | "hotfix"
  | "solo"
  | "design-spike"
  | "docs-pass"
  | "review-pass";

export interface JobStepTemplateMeta {
  id: JobStepTemplateId;
  /** Short label for the Job pane picker. */
  title: string;
  /** One sentence: when to use this shape. */
  detail: string;
}

export const JOB_STEP_TEMPLATES: readonly JobStepTemplateMeta[] = [
  {
    id: "pipeline",
    title: "Design → code → test → docs",
    detail: "One folder, strict order. Each role pulls, works, commits, then the next starts.",
  },
  {
    id: "parallel-feature",
    title: "Design → parallel features → integrate",
    detail: "After design, several developers work on different folders/branches, then one integrate + test + docs.",
  },
  {
    id: "parallel-test",
    title: "Code → parallel testers → docs",
    detail: "Assume code is ready. Several testers cover different areas in parallel, then docs.",
  },
  {
    id: "hotfix",
    title: "Hotfix",
    detail: "Developer fixes, tester verifies — short chain on the same folder.",
  },
  {
    id: "solo",
    title: "Solo developer",
    detail: "One machine does design, code, tests, and a short note end-to-end.",
  },
  {
    id: "design-spike",
    title: "Design only",
    detail: "Produce and commit a design doc; stop there.",
  },
  {
    id: "docs-pass",
    title: "Docs pass",
    detail: "Document existing design, code, and tests — no new product code.",
  },
  {
    id: "review-pass",
    title: "Parallel review",
    detail: "After implementation, two reviewers in parallel on different concerns, then docs.",
  },
];

export interface SuggestJobStepsOptions {
  templateId?: JobStepTemplateId;
  /** Parallel fan-out width (feature branches / testers). Default 2, clamped 2–4. */
  parallelCount?: number;
  hint?: string;
  cwdHint?: string;
}

function clampParallel(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(2, Math.floor(n)));
}

function pickTemplateId(hint: string | undefined, explicit?: JobStepTemplateId): JobStepTemplateId {
  if (explicit) return explicit;
  const h = (hint ?? "").toLowerCase();
  if (/hot\s*fix|urgent|patch/.test(h)) return "hotfix";
  if (/solo|alone|single/.test(h)) return "solo";
  if (/design\s*only|spike|rfc/.test(h)) return "design-spike";
  if (/docs?\s*only|documentation\s*pass|changelog/.test(h)) return "docs-pass";
  if (/parallel\s*test|many\s*tester|two\s*tester/.test(h)) return "parallel-test";
  if (/parallel|two\s*dev|feature\s*branch|fan-?out/.test(h)) return "parallel-feature";
  if (/review\s*pass|two\s*review/.test(h)) return "review-pass";
  return "pipeline";
}

function step(
  id: string,
  role: JobRole,
  brief: string,
  worktreeKey: string,
  cwdHint: string,
  dependsOn?: readonly string[],
): TemplateStepDraft {
  return {
    id,
    role,
    brief,
    worktreeKey,
    cwdHint,
    ...(dependsOn && dependsOn.length > 0 ? { dependsOn: [...dependsOn] } : {}),
  };
}

/**
 * Build a proposal for `updateJobSteps`. Stable ids (`s1`…) so `dependsOn` wires correctly.
 */
export function buildJobStepTemplate(
  job: Pick<Job, "title" | "goal" | "projectId">,
  options: SuggestJobStepsOptions = {},
): { templateId: JobStepTemplateId; steps: TemplateStepDraft[]; note: string } {
  const templateId = pickTemplateId(options.hint, options.templateId);
  const base = job.projectId ?? "default";
  const cwd = options.cwdHint?.trim() || ".";
  const goal = options.hint?.trim() || job.goal.slice(0, 240);
  const title = job.title;
  const n = clampParallel(options.parallelCount);
  const meta = JOB_STEP_TEMPLATES.find((t) => t.id === templateId)!;

  let steps: TemplateStepDraft[] = [];

  switch (templateId) {
    case "pipeline": {
      // Same worktreeKey: sequential — lock frees after each success; Git carries content.
      const key = `${base}:main`;
      steps = [
        step(
          "s1",
          "designer",
          `Write the design for “${title}” (${goal}). Commit the design doc to the shared branch, then stop.`,
          key,
          cwd,
        ),
        step(
          "s2",
          "developer",
          `Pull latest. Read the design doc. Implement “${title}”, commit code on the shared branch.`,
          key,
          cwd,
          ["s1"],
        ),
        step(
          "s3",
          "tester",
          `Pull latest. Add/run tests for “${title}”, commit tests, report results.`,
          key,
          cwd,
          ["s2"],
        ),
        step(
          "s4",
          "document",
          `Pull latest. Write user/developer docs from design, code, and tests. Commit docs.`,
          key,
          cwd,
          ["s3"],
        ),
      ];
      break;
    }
    case "parallel-feature": {
      const design = step(
        "s1",
        "designer",
        `Write the design for “${title}” (${goal}). Commit the design doc, then stop.`,
        `${base}:main`,
        cwd,
      );
      const featureIds: string[] = [];
      const features: TemplateStepDraft[] = [];
      for (let i = 0; i < n; i++) {
        const id = `s${i + 2}`;
        featureIds.push(id);
        features.push(
          step(
            id,
            "developer",
            `Pull latest design. Implement feature slice ${i + 1}/${n} of “${title}” on its own branch/folder. Commit and open for integrate.`,
            `${base}:feature-${i + 1}`,
            cwd,
            ["s1"],
          ),
        );
      }
      const integrateId = `s${n + 2}`;
      const testId = `s${n + 3}`;
      const docsId = `s${n + 4}`;
      steps = [
        design,
        ...features,
        step(
          integrateId,
          "developer",
          `Merge/rebase feature slices 1–${n} into the shared branch for “${title}”. Resolve conflicts, commit the integrate.`,
          `${base}:main`,
          cwd,
          featureIds,
        ),
        step(
          testId,
          "tester",
          `Pull integrated branch. Test “${title}” end-to-end, commit tests, report.`,
          `${base}:main`,
          cwd,
          [integrateId],
        ),
        step(
          docsId,
          "document",
          `Pull latest. Document “${title}” from design + integrated code + tests. Commit docs.`,
          `${base}:main`,
          cwd,
          [testId],
        ),
      ];
      break;
    }
    case "parallel-test": {
      const code = step(
        "s1",
        "developer",
        `Ensure “${title}” code is on the shared branch (pull/commit any missing pieces). Ready for testers.`,
        `${base}:main`,
        cwd,
      );
      const testerIds: string[] = [];
      const testers: TemplateStepDraft[] = [];
      for (let i = 0; i < n; i++) {
        const id = `s${i + 2}`;
        testerIds.push(id);
        testers.push(
          step(
            id,
            "tester",
            `Pull latest. Own test area ${i + 1}/${n} for “${title}” (do not block other testers’ folders). Commit tests for your area.`,
            `${base}:test-${i + 1}`,
            cwd,
            ["s1"],
          ),
        );
      }
      const docsId = `s${n + 2}`;
      steps = [
        code,
        ...testers,
        step(
          docsId,
          "document",
          `Pull latest. Summarize test coverage and usage for “${title}”. Commit docs.`,
          `${base}:main`,
          cwd,
          testerIds,
        ),
      ];
      break;
    }
    case "hotfix": {
      const key = `${base}:main`;
      steps = [
        step(
          "s1",
          "developer",
          `Hotfix “${title}”: pull, fix (${goal}), commit on the shared branch.`,
          key,
          cwd,
        ),
        step(
          "s2",
          "tester",
          `Pull the hotfix. Verify “${title}”, add a regression test if needed, commit, report.`,
          key,
          cwd,
          ["s1"],
        ),
      ];
      break;
    }
    case "solo": {
      steps = [
        step(
          "s1",
          "developer",
          `Solo delivery of “${title}” (${goal}): design note, implementation, tests, and a short README. Pull first; commit in logical commits on the shared branch.`,
          `${base}:main`,
          cwd,
        ),
      ];
      break;
    }
    case "design-spike": {
      steps = [
        step(
          "s1",
          "designer",
          `Design spike for “${title}” (${goal}). Write and commit the design doc only.`,
          `${base}:main`,
          cwd,
        ),
      ];
      break;
    }
    case "docs-pass": {
      steps = [
        step(
          "s1",
          "document",
          `Docs pass for “${title}” (${goal}). Pull latest design/code/tests; write and commit documentation only.`,
          `${base}:main`,
          cwd,
        ),
      ];
      break;
    }
    case "review-pass": {
      steps = [
        step(
          "s1",
          "developer",
          `Confirm “${title}” is ready for review on the shared branch (pull/commit if needed).`,
          `${base}:main`,
          cwd,
        ),
        step(
          "s2",
          "tester",
          `Review A for “${title}”: correctness / regressions. Commit review notes or follow-up tests.`,
          `${base}:review-a`,
          cwd,
          ["s1"],
        ),
        step(
          "s3",
          "tester",
          `Review B for “${title}”: edge cases / UX / docs gaps. Commit review notes.`,
          `${base}:review-b`,
          cwd,
          ["s1"],
        ),
        step(
          "s4",
          "document",
          `Pull reviews. Fold findings into docs for “${title}”. Commit.`,
          `${base}:main`,
          cwd,
          ["s2", "s3"],
        ),
      ];
      break;
    }
    default: {
      const _exhaustive: never = templateId;
      throw new Error(`Unknown template ${_exhaustive}`);
    }
  }

  return {
    templateId,
    steps,
    note: `${meta.title} — proposal only. Review steps, then save. Daemon does not auto-start. Git pull/commit is in each brief.`,
  };
}

export function listJobStepTemplates(): readonly JobStepTemplateMeta[] {
  return JOB_STEP_TEMPLATES;
}
