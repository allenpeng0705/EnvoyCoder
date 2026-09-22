/**
 * Panel width persistence and clamp math — no DOM.
 */

import { describe, expect, it } from "vitest";

import {
  EXPLORER_WIDTH_DEFAULT,
  EXPLORER_WIDTH_MAX,
  EXPLORER_WIDTH_MIN,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  SETTINGS_NAV_WIDTH_DEFAULT,
  SETTINGS_NAV_WIDTH_MAX,
  SETTINGS_NAV_WIDTH_MIN,
} from "../src/layout/panel-widths.js";

describe("panel width bounds", () => {
  it("keeps defaults inside the drag range", () => {
    expect(RAIL_WIDTH_DEFAULT).toBeGreaterThanOrEqual(RAIL_WIDTH_MIN);
    expect(RAIL_WIDTH_DEFAULT).toBeLessThanOrEqual(RAIL_WIDTH_MAX);
    expect(SETTINGS_NAV_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SETTINGS_NAV_WIDTH_MIN);
    expect(SETTINGS_NAV_WIDTH_DEFAULT).toBeLessThanOrEqual(SETTINGS_NAV_WIDTH_MAX);
    expect(EXPLORER_WIDTH_DEFAULT).toBeGreaterThanOrEqual(EXPLORER_WIDTH_MIN);
    expect(EXPLORER_WIDTH_DEFAULT).toBeLessThanOrEqual(EXPLORER_WIDTH_MAX);
  });
});
