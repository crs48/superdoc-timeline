import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Below this the chart is unreadable; the dock collapses instead of shrinking. */
export const DOCK_MIN_HEIGHT = 96;

/** The document must keep the majority of the screen. */
export function dockMaxHeight(): number {
  return Math.round(window.innerHeight * 0.6);
}

export function clampDockHeight(height: number): number {
  return Math.min(Math.max(height, DOCK_MIN_HEIGHT), dockMaxHeight());
}

interface DockState {
  /** Expanded body height in px. Clamped on write, not on read. */
  height: number;
  collapsed: boolean;
  /** Author-threads lens over the map (exploration 0012). */
  threads: boolean;
  setHeight: (height: number) => void;
  toggleCollapsed: () => void;
  toggleThreads: () => void;
}

/**
 * Chrome preferences for the timeline dock. Persisted per browser profile —
 * how tall someone likes their chart is a durable fact about them, not about
 * any one room. Small screens default collapsed so the document wins.
 */
export const useDock = create<DockState>()(
  persist(
    (set) => ({
      height: 260,
      collapsed: typeof window !== 'undefined' && window.innerWidth < 768,
      setHeight: (height) => set({ height: clampDockHeight(height), collapsed: false }),
      threads: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      toggleThreads: () => set((state) => ({ threads: !state.threads })),
    }),
    {
      name: 'superdoc-timeline:dock',
      partialize: (state) => ({
        height: state.height,
        collapsed: state.collapsed,
        threads: state.threads,
      }),
    },
  ),
);
