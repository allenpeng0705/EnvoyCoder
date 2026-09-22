/**
 * Drag handle between two panels — updates a CSS custom property while the pointer moves.
 *
 * Widths live as CSS variables on `:root` so the layout sheets stay declarative; this component only
 * writes numbers. Persistence is the caller's job (`usePanelWidths`).
 */

import type { JSX, PointerEvent as ReactPointerEvent } from "react";

import { useRef } from "react";

export interface ResizeHandleProps {
  /** CSS custom property to write, e.g. `--rail-width`. */
  cssVar: string;
  /** Which side grows when the pointer moves right. */
  edge: "start" | "end";
  min: number;
  max: number;
  defaultWidth: number;
  /** Accessible name for the separator. */
  label: string;
  className?: string;
  /** Called when a drag (or double-click reset) settles, so the caller can persist. */
  onResize: (px: number | undefined) => void;
}

export function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const dragging = useRef(false);
  const originX = useRef(0);
  const originWidth = useRef(0);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const current = readCssPx(props.cssVar) ?? props.defaultWidth;
    dragging.current = true;
    originX.current = event.clientX;
    originWidth.current = current;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("is-resizing-panels");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const delta = event.clientX - originX.current;
    const next =
      props.edge === "start" ? originWidth.current + delta : originWidth.current - delta;
    const clamped = Math.min(props.max, Math.max(props.min, Math.round(next)));
    document.documentElement.style.setProperty(props.cssVar, `${clamped}px`);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    document.documentElement.classList.remove("is-resizing-panels");
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    const width = readCssPx(props.cssVar);
    if (width !== undefined) props.onResize(width);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      className={["panel-resize", props.className].filter(Boolean).join(" ")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        document.documentElement.style.setProperty(props.cssVar, `${props.defaultWidth}px`);
        props.onResize(undefined);
      }}
    />
  );
}

function readCssPx(cssVar: string): number | undefined {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!raw.endsWith("px")) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}
