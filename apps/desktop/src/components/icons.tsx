/**
 * The icon set — five glyphs, inline, no dependency.
 *
 * The app had no icons at all: buttons were bare words, and the two glyphs that existed were text
 * characters (`＋`, `▾`) whose weight and alignment differ per platform font. Paseo draws every icon as
 * an SVG from a per-file import of `lucide-react-native`; we cannot use that library (it is React
 * Native), so the equivalent is a handful of paths here — and the two rules that matter are kept:
 * **`currentColor`** so an icon inherits the button's state colours, and **`aria-hidden`** so a label
 * beside it is not read twice.
 *
 * Deliberately tiny and hand-written rather than a dependency: five icons at 24-unit viewBox, all
 * stroke-based, all matching the 14–16px sizes in `docs/design-tokens.md`.
 */

import type { JSX } from "react";

interface IconProps {
  /** Rendered size in px. Defaults to the 16px control size. */
  size?: number;
}

function frame(size: number): {
  width: number;
  height: number;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
  "aria-hidden": true;
  focusable: "false";
} {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
  };
}

/** Settings — the gear. */
export function GearIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Host — a machine on the network. */
export function ServerIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

/** Import — an arrow into a tray. */
export function ImportIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Help — a question mark in a circle. */
export function HelpIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.6 1.3c0 1.7-2.1 2-2.1 3.2" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

/** Add — the plus, for "Add project". */
export function PlusIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Search — a magnifier. */
export function SearchIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...frame(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
