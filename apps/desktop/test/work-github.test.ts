import { describe, expect, it, vi } from "vitest";

import {
  parseGhJsonArray,
  pollGithubTriggers,
  replyOnGithubThread,
} from "../src/daemon/work-github.js";

describe("work-github", () => {
  it("polls a repo comments feed and files mention candidates once", async () => {
    const runGh = vi.fn(async () => ({
      ok: true,
      // --slurp wraps each page; one page is an outer array of the page array.
      stdout: JSON.stringify([
        [
          {
            id: 77,
            body: "@envoy please look",
            user: { login: "bob" },
            created_at: "2026-01-01T00:00:00Z",
            issue_url: "https://api.github.com/repos/acme/app/issues/3",
          },
        ],
      ]),
      stderr: "",
    }));

    const stored = new Set<string>();
    const mentions: string[] = [];
    const storeTrigger = async (trigger: { id: string }) => {
      if (stored.has(trigger.id)) return "duplicate" as const;
      stored.add(trigger.id);
      return "stored" as const;
    };

    const first = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      agentNames: ["envoy"],
      storeTrigger,
      isKnownTrigger: (id) => stored.has(id),
      onMention: (trigger) => {
        mentions.push(trigger.text);
      },
    });
    const second = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      agentNames: ["envoy"],
      storeTrigger,
      isKnownTrigger: (id) => stored.has(id),
      onMention: (trigger) => {
        mentions.push(trigger.text);
      },
    });

    expect(first.ok).toBe(true);
    expect(first.triggers).toBe(1);
    expect(first.candidates).toBe(1);
    expect(second.ok).toBe(true);
    expect(second.triggers).toBe(0);
    expect(second.candidates).toBe(0);
    expect(mentions).toHaveLength(1);
    expect(runGh.mock.calls[0]![0]).toEqual(
      expect.arrayContaining(["--paginate", "--slurp"]),
    );
  });

  it("does not consume a mention trigger when onMention defers", async () => {
    const runGh = vi.fn(async () => ({
      ok: true,
      stdout: JSON.stringify([
        [
          {
            id: 88,
            body: "@envoy please look",
            user: { login: "bob" },
            created_at: "2026-01-01T00:00:00Z",
            issue_url: "https://api.github.com/repos/acme/app/issues/3",
          },
        ],
      ]),
      stderr: "",
    }));
    const stored = new Set<string>();
    const storeTrigger = async (trigger: { id: string }) => {
      if (stored.has(trigger.id)) return "duplicate" as const;
      stored.add(trigger.id);
      return "stored" as const;
    };

    const deferred = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      agentNames: ["envoy"],
      storeTrigger,
      isKnownTrigger: (id) => stored.has(id),
      onMention: () => false,
    });
    expect(deferred.ok).toBe(true);
    expect(deferred.candidates).toBe(0);
    expect(stored.size).toBe(0);

    const mentions: string[] = [];
    const handled = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      agentNames: ["envoy"],
      storeTrigger,
      isKnownTrigger: (id) => stored.has(id),
      onMention: (trigger) => {
        mentions.push(trigger.text);
        return true;
      },
    });
    expect(handled.candidates).toBe(1);
    expect(stored.size).toBe(1);
    expect(mentions).toHaveLength(1);
  });

  it("does not treat bare agent name as a mention", async () => {
    const runGh = vi.fn(async () => ({
      ok: true,
      stdout: JSON.stringify([
        [
          {
            id: 78,
            body: "please ask envoy about this",
            user: { login: "bob" },
            created_at: "2026-01-01T00:00:00Z",
            issue_url: "https://api.github.com/repos/acme/app/issues/3",
          },
        ],
      ]),
      stderr: "",
    }));
    const mentions: string[] = [];
    const result = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      agentNames: ["envoy"],
      storeTrigger: async () => "stored",
      onMention: (trigger) => {
        mentions.push(trigger.text);
      },
    });
    expect(result.ok).toBe(true);
    expect(result.triggers).toBe(1);
    expect(result.candidates).toBe(0);
    expect(mentions).toHaveLength(0);
  });

  it("returns ok:false when gh is missing", async () => {
    const runGh = vi.fn(async () => ({
      ok: false,
      stdout: "",
      stderr: "gh not available",
    }));
    const result = await pollGithubTriggers(runGh, {
      repo: "acme/app",
      storeTrigger: async () => "stored",
    });
    expect(result.ok).toBe(false);
    expect(result.triggers).toBe(0);
    expect(result.candidates).toBe(0);
    expect(result.error).toMatch(/gh CLI is not available/i);
  });

  it("follows PR notification subjects via /pulls/ URLs", async () => {
    const runGh = vi.fn(async (args: string[]) => {
      if (args.includes("notifications")) {
        return {
          ok: true,
          stdout: JSON.stringify([
            [
              {
                subject: {
                  url: "https://api.github.com/repos/acme/app/pulls/9",
                  title: "Fix",
                },
              },
            ],
          ]),
          stderr: "",
        };
      }
      return {
        ok: true,
        stdout: JSON.stringify([
          [
            {
              id: 91,
              body: "@envoy please review",
              user: { login: "carol" },
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        ]),
        stderr: "",
      };
    });
    const mentions: string[] = [];
    const result = await pollGithubTriggers(runGh, {
      storeTrigger: async () => "stored",
      onMention: (trigger) => {
        mentions.push(trigger.threadKey);
      },
    });
    expect(result.ok).toBe(true);
    expect(result.candidates).toBe(1);
    expect(mentions).toEqual(["github:acme/app#9"]);
    expect(runGh.mock.calls.some((call) => (call[0] as string[]).some((a) => a.includes("/issues/9/comments")))).toBe(
      true,
    );
  });

  it("parses slurped multi-page arrays", () => {
    expect(parseGhJsonArray(JSON.stringify([[{ id: 1 }], [{ id: 2 }]]))).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseGhJsonArray(JSON.stringify([{ id: 1 }]))).toEqual([{ id: 1 }]);
  });

  it("replies on github:owner/repo#N threads via JSON stdin", async () => {
    const runGh = vi.fn(async (_args: string[], _options?: { stdin?: string }) => ({
      ok: true,
      stdout: "{}",
      stderr: "",
    }));
    const result = await replyOnGithubThread(runGh, "github:acme/app#9", 'done with "quotes"');
    expect(result.ok).toBe(true);
    expect(runGh).toHaveBeenCalled();
    const args = runGh.mock.calls[0]![0] as string[];
    const options = runGh.mock.calls[0]![1] as { stdin?: string };
    expect(args.join(" ")).toContain("repos/acme/app/issues/9/comments");
    expect(args).toContain("--input");
    expect(args).toContain("-");
    expect(options.stdin).toBe(JSON.stringify({ body: 'done with "quotes"' }));
  });
});
