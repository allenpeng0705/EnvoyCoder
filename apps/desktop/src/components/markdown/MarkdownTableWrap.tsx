/**
 * Wide GFM tables: sideways scroll with an always-visible custom rail.
 * Native macOS overlay scrollbars stay hidden until hover — this rail is the affordance.
 * Track click jumps; thumb (and track-initiated) drag scrolls.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";

export function MarkdownTableWrap(props: { children: ReactNode }): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    trackWidth: number;
    thumbWidthPx: number;
  } | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState({ leftPct: 0, widthPct: 100 });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const canScroll = scrollWidth > clientWidth + 1;
    setOverflows(canScroll);
    if (!canScroll || clientWidth <= 0 || scrollWidth <= 0) {
      setThumb({ leftPct: 0, widthPct: 100 });
      return;
    }
    const widthPct = Math.max(12, (clientWidth / scrollWidth) * 100);
    const maxLeft = 100 - widthPct;
    const leftPct =
      scrollWidth === clientWidth
        ? 0
        : (scrollLeft / (scrollWidth - clientWidth)) * maxLeft;
    setThumb({ leftPct, widthPct });
  }, []);

  const metrics = useCallback(() => {
    const el = scrollerRef.current;
    const rail = railRef.current;
    if (!el || !rail) return null;
    const rect = rail.getBoundingClientRect();
    const trackWidth = Math.max(1, rect.width);
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const widthPct = Math.max(12, scrollWidth > 0 ? (clientWidth / scrollWidth) * 100 : 100);
    const thumbWidthPx = (widthPct / 100) * trackWidth;
    const maxThumbLeft = Math.max(0, trackWidth - thumbWidthPx);
    return {
      el,
      rail,
      rect,
      trackWidth,
      scrollWidth,
      clientWidth,
      scrollLeft,
      maxScroll,
      widthPct,
      thumbWidthPx,
      maxThumbLeft,
    };
  }, []);

  const applyThumbLeftPx = useCallback(
    (thumbLeftPx: number) => {
      const m = metrics();
      if (!m || m.maxScroll <= 0 || m.maxThumbLeft <= 0) return;
      const clamped = Math.min(m.maxThumbLeft, Math.max(0, thumbLeftPx));
      m.el.scrollLeft = (clamped / m.maxThumbLeft) * m.maxScroll;
      measure();
    },
    [measure, metrics],
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, props.children]);

  const onScroll = (_e: UIEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    measure();
  };

  const beginDrag = (e: ReactPointerEvent<HTMLElement>, jumpToPointer: boolean) => {
    const m = metrics();
    if (!m || m.maxScroll <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (jumpToPointer) {
      const x = e.clientX - m.rect.left - m.thumbWidthPx / 2;
      applyThumbLeftPx(x);
    }

    const after = metrics();
    if (!after) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: after.el.scrollLeft,
      trackWidth: after.trackWidth,
      thumbWidthPx: after.thumbWidthPx,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const el = scrollerRef.current;
    if (!drag || !el || e.pointerId !== drag.pointerId) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxThumbLeft = Math.max(0, drag.trackWidth - drag.thumbWidthPx);
    if (maxScroll <= 0 || maxThumbLeft <= 0) return;
    const dx = e.clientX - drag.startX;
    el.scrollLeft = Math.min(
      maxScroll,
      Math.max(0, drag.startScrollLeft + (dx / maxThumbLeft) * maxScroll),
    );
    measure();
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    measure();
  };

  return (
    <div
      className={`md__table-wrap${overflows ? " md__table-wrap--scrollable" : ""}${dragging ? " md__table-wrap--dragging" : ""}`}
    >
      <div ref={scrollerRef} className="md__table-scroller" onScroll={onScroll}>
        {props.children}
      </div>
      {overflows ? (
        <div
          ref={railRef}
          className="md__table-rail"
          role="scrollbar"
          aria-orientation="horizontal"
          aria-label="Scroll table horizontally"
          onPointerDown={(e) => beginDrag(e, true)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="md__table-rail-thumb"
            style={{
              width: `${thumb.widthPct}%`,
              marginLeft: `${thumb.leftPct}%`,
            }}
            onPointerDown={(e) => beginDrag(e, false)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      ) : null}
    </div>
  );
}
