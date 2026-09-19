/**
 * The window must not import a package that needs Node.
 *
 * `@envoydev/agent-catalog` and `@envoydev/platform` pull `node:fs` and `node:child_process`. Vite
 * turns those into empty modules, the first script throws, and the Tauri window stays white — the
 * page never gets far enough to draw. The daemon may import them. The window may import only the
 * browser-safe subpath `@envoydev/agent-catalog/features`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const FORBIDDEN = /from ["']@envoydev\/(agent-catalog|platform)["']/g;

function files(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "daemon") continue;
      found.push(...files(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

describe("the window stays a browser bundle", () => {
  it("does not import the Node catalogue or platform packages", () => {
    const hits: string[] = [];
    for (const path of files(SRC)) {
      const text = readFileSync(path, "utf8");
      const matches = text.match(FORBIDDEN);
      if (matches) hits.push(`${path}: ${matches.join(", ")}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
