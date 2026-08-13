import { useRef, type ReactNode } from 'react';
import { useDock } from '@/store/dock';

interface TimelineDockProps {
  /** Segmented control / tabs rendered beside the title. */
  controls?: ReactNode;
  children: ReactNode;
}

/**
 * The timeline's chrome: a dock pinned to the bottom of the shell, always
 * visible, with a drag handle to resize and a chevron to collapse to its
 * header row. Height and collapsed state persist per browser profile.
 */
export function TimelineDock({ controls, children }: TimelineDockProps) {
  const height = useDock((s) => s.height);
  const collapsed = useDock((s) => s.collapsed);
  const setHeight = useDock((s) => s.setHeight);
  const toggleCollapsed = useDock((s) => s.toggleCollapsed);

  // Drag state lives in refs: a pointermove per pixel must not re-render, and
  // the rAF throttle below commits at most one height per frame.
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const pendingHeight = useRef<number>(height);
  const frame = useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (collapsed) return;
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || e.pointerId !== drag.current.pointerId) return;
    // Dragging up (smaller clientY) grows the dock.
    pendingHeight.current = drag.current.startHeight + (drag.current.startY - e.clientY);
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      setHeight(pendingHeight.current);
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || e.pointerId !== drag.current.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  }

  return (
    <section className="border-t border-slate-200 bg-white">
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
          className="group flex h-2 cursor-row-resize items-center justify-center touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-1 w-10 rounded-full bg-slate-300 group-hover:bg-slate-400" />
        </div>
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-1">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Edits</h2>
          {controls}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
        >
          {collapsed ? '▲ Expand' : '▼ Collapse'}
        </button>
      </header>

      {!collapsed ? (
        <div style={{ height }} className="overflow-hidden">
          {children}
        </div>
      ) : null}
    </section>
  );
}
