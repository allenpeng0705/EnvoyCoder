import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readLogTail } from "../src/daemon/log-tail.js";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function tempFile(name: string, contents: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-log-tail-"));
  homes.push(home);
  const file = join(home, name);
  await writeFile(file, contents, "utf8");
  return file;
}

describe("the end of a log file", () => {
  it("returns a short log whole, and says it is not truncated", async () => {
    const file = await tempFile("daemon.log", "first\nsecond\nthird\n");
    const tail = await readLogTail({ candidates: [file] });
    expect(tail.lines).toEqual(["first", "second", "third"]);
    expect(tail.truncated).toBe(false);
    expect(tail.path).toBe(file);
  });

  it("returns only the tail of a long log, and says there is more", async () => {
    // The byte bound keeps the window from allocating whatever the log has grown to; the line bound keeps it from
    // rendering a megabyte of text to show three lines.
    const file = await tempFile(
      "daemon.log",
      Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") + "\n",
    );
    const tail = await readLogTail({ candidates: [file], lines: 5, maxBytes: 100 });
    expect(tail.lines).toHaveLength(5);
    expect(tail.lines[4]).toBe("line 499");
    expect(tail.truncated).toBe(true);
  });

  it("never presents half a line as a whole one", async () => {
    // A read that starts mid-file starts mid-line; the fragment is dropped rather than shown as though somebody
    // had written it that way.
    const file = await tempFile("daemon.log", "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n");
    const tail = await readLogTail({ candidates: [file], maxBytes: 15 });
    expect(tail.lines).not.toContain("aaaaaaaaaa");
    expect(tail.lines[tail.lines.length - 1]).toBe("cccccccccc");
  });

  it("answers an empty tail when there is no log at all, which is not an error", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-log-tail-"));
    homes.push(home);
    const wanted = join(home, "service.log");
    const tail = await readLogTail({ candidates: [wanted, join(home, "daemon.log")] });
    expect(tail.lines).toEqual([]);
    expect(tail.truncated).toBe(false);
    // The path reported is the one that was wanted, so a row can name the missing file instead of showing nothing.
    expect(tail.path).toBe(wanted);
  });

  it("prefers the first candidate that exists, because a daemon has two possible logs", async () => {
    const service = await tempFile("service.log", "the supervisor's copy\n");
    const daemon = await tempFile("daemon.log", "the shell's copy\n");
    expect((await readLogTail({ candidates: [service, daemon] })).lines).toEqual(["the supervisor's copy"]);
    // With the service log gone, the app-managed log answers rather than "no log".
    await rm(service, { force: true });
    expect((await readLogTail({ candidates: [service, daemon] })).lines).toEqual(["the shell's copy"]);
  });

  it("ignores a directory wearing the log's name", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-log-tail-"));
    homes.push(home);
    expect((await readLogTail({ candidates: [home] })).lines).toEqual([]);
  });
});
