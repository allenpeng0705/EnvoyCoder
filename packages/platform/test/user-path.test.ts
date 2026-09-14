/**
 * The path a person typed, turned into what the filesystem means.
 *
 * `~/work/api`, a quoted path with a space, and a trailing slash from Finder are all the same directory.
 * All three used to reach the daemon's existence check unchanged and come back as "not a directory on
 * this machine" — while the user was looking at it.
 */

import { describe, expect, it } from "vitest";

import { normalizeUserPath } from "../src/index.js";

const home = "/Users/ada";

describe("normalizing a typed path", () => {
  it("expands a leading tilde, alone or before a separator", () => {
    expect(normalizeUserPath("~/work/api", home)).toBe("/Users/ada/work/api");
    expect(normalizeUserPath("~", home)).toBe("/Users/ada");
  });

  it("does not touch a tilde in the middle of a name — that is a real character", () => {
    expect(normalizeUserPath("/tmp/back~up", home)).toBe("/tmp/back~up");
  });

  it("strips one matching pair of quotes, and only a matching pair", () => {
    expect(normalizeUserPath('"/Users/ada/my repo"', home)).toBe("/Users/ada/my repo");
    expect(normalizeUserPath("'/Users/ada/my repo'", home)).toBe("/Users/ada/my repo");
    // A lone quote can be part of a filename; removing it would invent a path.
    expect(normalizeUserPath('"/Users/ada/odd', home)).toBe('"/Users/ada/odd');
  });

  it("drops a trailing separator but never the root", () => {
    expect(normalizeUserPath("/Users/ada/work/", home)).toBe("/Users/ada/work");
    expect(normalizeUserPath("/", home)).toBe("/");
  });

  it("trims the surrounding whitespace a paste brings", () => {
    expect(normalizeUserPath("  ~/work/api  ", home)).toBe("/Users/ada/work/api");
  });
});
