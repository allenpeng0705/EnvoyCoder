/**
 * GitHub Source edge — `gh api` only, no GitHub SDK in the engine core.
 */

import { spawn } from "node:child_process";

import {
  looksLikeAgentMention,
  triggerFromGithubComment,
  type WorkTrigger,
} from "@envoydev/work-model";

export type RunGh = (
  args: string[],
  options?: { stdin?: string },
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

const GH_TIMEOUT_MS = 30_000;

/** Default runner — tests inject a stub so CI never needs the real CLI. */
export function defaultRunGh(
  args: string[],
  options: { stdin?: string } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\ngh timed out`.trim() });
    }, GH_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", stderr: "gh not available" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, "utf8");
    } else {
      child.stdin?.end();
    }
  });
}

function parseThreadRepoNumber(threadKey: string): { repo: string; number: number } | undefined {
  const match = /^github:([^#]+)#(\d+)$/.exec(threadKey.trim());
  if (!match) return undefined;
  const number = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(number)) return undefined;
  return { repo: match[1]!, number };
}

export async function replyOnGithubThread(
  runGh: RunGh,
  threadKey: string,
  body: string,
): Promise<{ ok: boolean; stderr: string }> {
  const parsed = parseThreadRepoNumber(threadKey);
  if (!parsed) return { ok: false, stderr: "Unrecognized thread key." };
  const [owner, repo] = parsed.repo.split("/");
  if (!owner || !repo) return { ok: false, stderr: "Repo must be owner/name." };
  const result = await runGh(
    ["api", `repos/${owner}/${repo}/issues/${parsed.number}/comments`, "-X", "POST", "--input", "-"],
    { stdin: JSON.stringify({ body }) },
  );
  return { ok: result.ok, stderr: result.stderr };
}

interface GithubCommentRow {
  id?: number | string;
  body?: string;
  user?: { login?: string };
  created_at?: string;
  issue_url?: string;
}

function commentToTrigger(repo: string, issueNumber: number, row: GithubCommentRow): WorkTrigger | undefined {
  const commentId = row.id;
  const body = typeof row.body === "string" ? row.body : "";
  if (commentId === undefined || body.trim() === "") return undefined;
  return triggerFromGithubComment({
    repo,
    number: issueNumber,
    commentId: String(commentId),
    body,
    ...(row.user?.login ? { actor: row.user.login } : {}),
    ...(row.created_at ? { at: row.created_at } : {}),
  });
}

function ghFailureMessage(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.includes("gh not available")) {
    return "The gh CLI is not available on this machine. Install GitHub CLI and sign in (gh auth login).";
  }
  if (trimmed.length === 0) return "GitHub poll failed.";
  // First line only — keep Settings notices short.
  return trimmed.split("\n")[0]!.slice(0, 240);
}

/**
 * `gh api --paginate --slurp` wraps each page in an outer array. One page without
 * multi-page shape is a flat array of rows. Accept either.
 */
export function parseGhJsonArray(stdout: string): unknown[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];
  if (parsed.length === 0) return [];
  if (Array.isArray(parsed[0])) return (parsed as unknown[][]).flat();
  return parsed;
}

function issueNumberFromCommentUrl(issueUrl: string | undefined): number | undefined {
  if (!issueUrl) return undefined;
  // Comment payloads use /issues/N even for PRs; accept /pulls/N just in case.
  const match = /\/(?:issues|pulls)\/(\d+)(?:$|[/?#])/.exec(issueUrl);
  if (!match) return undefined;
  const number = Number.parseInt(match[1]!, 10);
  return Number.isFinite(number) ? number : undefined;
}

function repoAndNumberFromSubjectUrl(url: string): { repo: string; number: number } | undefined {
  // Notifications use /issues/N for issues and /pulls/N for PRs — both share the issues comments API.
  const match = /repos\/([^/]+\/[^/]+)\/(?:issues|pulls)\/(\d+)/.exec(url);
  if (!match) return undefined;
  const number = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(number)) return undefined;
  return { repo: match[1]!, number };
}

export type PollGithubResult = {
  ok: boolean;
  triggers: number;
  candidates: number;
  error?: string;
};

/**
 * onMention return values:
 * - `false` — defer (do not persist the trigger; a later poll may handle it)
 * - `true` / `void` — handled; persist the trigger for dedupe
 */
export async function pollGithubTriggers(
  runGh: RunGh,
  input: {
    repo?: string;
    agentNames?: readonly string[];
    storeTrigger: (trigger: WorkTrigger) => Promise<"duplicate" | "stored">;
    isKnownTrigger?: (id: string) => boolean;
    onMention?: (trigger: WorkTrigger) => boolean | void | Promise<boolean | void>;
  },
): Promise<PollGithubResult> {
  const names = input.agentNames ?? ["envoydev", "envoy"];
  let stored = 0;
  let candidates = 0;

  const persistAndCount = async (trigger: WorkTrigger, asCandidate: boolean): Promise<void> => {
    const outcome = await input.storeTrigger(trigger);
    if (outcome !== "stored") return;
    stored += 1;
    if (asCandidate) candidates += 1;
  };

  const handleRows = async (repo: string, issueNumber: number, rows: GithubCommentRow[]): Promise<void> => {
    for (const row of rows) {
      const trigger = commentToTrigger(repo, issueNumber, row);
      if (!trigger) continue;
      if (input.isKnownTrigger?.(trigger.id)) continue;

      if (looksLikeAgentMention(trigger.text, names)) {
        let handled: boolean | void = true;
        try {
          handled = await input.onMention?.(trigger);
        } catch {
          // Leave unstored so a later poll can retry this mention.
          continue;
        }
        if (handled === false) continue;
        await persistAndCount(trigger, true);
        continue;
      }

      await persistAndCount(trigger, false);
    }
  };

  if (input.repo) {
    const result = await runGh([
      "api",
      `repos/${input.repo}/issues/comments`,
      "--paginate",
      "--slurp",
    ]);
    if (!result.ok) {
      return { ok: false, triggers: 0, candidates: 0, error: ghFailureMessage(result.stderr) };
    }
    let rows: GithubCommentRow[] = [];
    try {
      rows = parseGhJsonArray(result.stdout) as GithubCommentRow[];
    } catch {
      return { ok: false, triggers: 0, candidates: 0, error: "GitHub returned unreadable comment JSON." };
    }
    for (const row of rows) {
      const issueNumber = issueNumberFromCommentUrl(row.issue_url);
      if (issueNumber === undefined) continue;
      const trigger = commentToTrigger(input.repo, issueNumber, row);
      if (!trigger) continue;
      if (input.isKnownTrigger?.(trigger.id)) continue;

      if (looksLikeAgentMention(trigger.text, names)) {
        let handled: boolean | void = true;
        try {
          handled = await input.onMention?.(trigger);
        } catch {
          continue;
        }
        if (handled === false) continue;
        await persistAndCount(trigger, true);
        continue;
      }

      await persistAndCount(trigger, false);
    }
    return { ok: true, triggers: stored, candidates };
  }

  const notifications = await runGh(["api", "notifications", "--paginate", "--slurp"]);
  if (!notifications.ok) {
    return { ok: false, triggers: 0, candidates: 0, error: ghFailureMessage(notifications.stderr) };
  }
  let items: { subject?: { url?: string; title?: string } }[] = [];
  try {
    items = parseGhJsonArray(notifications.stdout) as typeof items;
  } catch {
    return { ok: false, triggers: 0, candidates: 0, error: "GitHub returned unreadable notifications JSON." };
  }

  for (const item of items) {
    const parsed = repoAndNumberFromSubjectUrl(item.subject?.url ?? "");
    if (!parsed) continue;
    const comments = await runGh([
      "api",
      `repos/${parsed.repo}/issues/${parsed.number}/comments`,
      "--paginate",
      "--slurp",
    ]);
    if (!comments.ok) continue;
    let rows: GithubCommentRow[] = [];
    try {
      rows = parseGhJsonArray(comments.stdout) as GithubCommentRow[];
    } catch {
      rows = [];
    }
    // Lightweight notifications poll: only the newest few comments per thread.
    await handleRows(parsed.repo, parsed.number, rows.slice(-5));
  }

  return { ok: true, triggers: stored, candidates };
}
