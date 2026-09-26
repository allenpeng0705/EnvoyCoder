/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { applyTheme, isDarkTheme } from "../src/design/applyTheme.js";

describe("applyTheme", () => {
  it("writes light and dark onto the root", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
  });

  it("clears the attribute for system, so the OS media query can win", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    applyTheme("system", root);
    expect(root.getAttribute("data-theme")).toBeNull();
  });
});

describe("isDarkTheme", () => {
  it("follows an explicit data-theme", () => {
    const root = document.createElement("html");
    applyTheme("dark", root);
    expect(isDarkTheme(root)).toBe(true);
    applyTheme("light", root);
    expect(isDarkTheme(root)).toBe(false);
  });
});
