/**
 * Persist left-rail, settings-nav, and right-explorer widths across reloads.
 *
 * Window chrome, not product settings: `localStorage` is enough, and a daemon round-trip would be the
 * wrong place for a drag that settles every few pixels.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "envoydev.panel-widths";

export const RAIL_WIDTH_VAR = "--rail-width";
export const SETTINGS_NAV_WIDTH_VAR = "--settings-nav-width";
export const EXPLORER_WIDTH_VAR = "--explorer-width";

export const RAIL_WIDTH_DEFAULT = 300;
export const SETTINGS_NAV_WIDTH_DEFAULT = 280;
export const EXPLORER_WIDTH_DEFAULT = 288; /* 18rem at 16px */

export const RAIL_WIDTH_MIN = 200;
export const RAIL_WIDTH_MAX = 560;
export const SETTINGS_NAV_WIDTH_MIN = 180;
export const SETTINGS_NAV_WIDTH_MAX = 420;
export const EXPLORER_WIDTH_MIN = 200;
export const EXPLORER_WIDTH_MAX = 560;

interface StoredWidths {
  rail?: number;
  settingsNav?: number;
  explorer?: number;
}

function readStored(): StoredWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredWidths;
    return {
      ...(typeof parsed.rail === "number" ? { rail: clamp(parsed.rail, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX) } : {}),
      ...(typeof parsed.settingsNav === "number"
        ? { settingsNav: clamp(parsed.settingsNav, SETTINGS_NAV_WIDTH_MIN, SETTINGS_NAV_WIDTH_MAX) }
        : {}),
      ...(typeof parsed.explorer === "number"
        ? { explorer: clamp(parsed.explorer, EXPLORER_WIDTH_MIN, EXPLORER_WIDTH_MAX) }
        : {}),
    };
  } catch {
    return {};
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function applyVar(name: string, px: number | undefined, fallback: number): void {
  document.documentElement.style.setProperty(name, `${px ?? fallback}px`);
}

/** Apply stored widths once on mount; keep state so a drag can write back. */
export function usePanelWidths(): {
  railWidth: number;
  settingsNavWidth: number;
  explorerWidth: number;
  setRailWidth: (px: number | undefined) => void;
  setSettingsNavWidth: (px: number | undefined) => void;
  setExplorerWidth: (px: number | undefined) => void;
} {
  const [widths, setWidths] = useState<StoredWidths>(() => readStored());

  useEffect(() => {
    applyVar(RAIL_WIDTH_VAR, widths.rail, RAIL_WIDTH_DEFAULT);
    applyVar(SETTINGS_NAV_WIDTH_VAR, widths.settingsNav, SETTINGS_NAV_WIDTH_DEFAULT);
    applyVar(EXPLORER_WIDTH_VAR, widths.explorer, EXPLORER_WIDTH_DEFAULT);
  }, [widths.rail, widths.settingsNav, widths.explorer]);

  const persist = (next: StoredWidths): void => {
    setWidths(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — the drag still updates the live CSS var */
    }
  };

  return {
    railWidth: widths.rail ?? RAIL_WIDTH_DEFAULT,
    settingsNavWidth: widths.settingsNav ?? SETTINGS_NAV_WIDTH_DEFAULT,
    explorerWidth: widths.explorer ?? EXPLORER_WIDTH_DEFAULT,
    setRailWidth: (px) => {
      const next = { ...widths };
      if (px === undefined) delete next.rail;
      else next.rail = clamp(px, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX);
      persist(next);
    },
    setSettingsNavWidth: (px) => {
      const next = { ...widths };
      if (px === undefined) delete next.settingsNav;
      else next.settingsNav = clamp(px, SETTINGS_NAV_WIDTH_MIN, SETTINGS_NAV_WIDTH_MAX);
      persist(next);
    },
    setExplorerWidth: (px) => {
      const next = { ...widths };
      if (px === undefined) delete next.explorer;
      else next.explorer = clamp(px, EXPLORER_WIDTH_MIN, EXPLORER_WIDTH_MAX);
      persist(next);
    },
  };
}
