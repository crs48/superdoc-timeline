import { create } from 'zustand';
import type { Contributor, ContributionEvent } from '@/types';

interface ActivityState {
  /**
   * Keyed by the event's content-derived id. Polling deliberately re-fetches
   * overlapping windows, so upserting by id is what keeps the series stable
   * instead of double-counting every burst near the window boundary.
   */
  events: Map<string, ContributionEvent>;
  contributors: Contributor[];
  lastFetchAt: number | null;
  error: string | null;

  ingest: (events: ContributionEvent[], contributors: Contributor[]) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useActivity = create<ActivityState>()((set) => ({
  events: new Map(),
  contributors: [],
  lastFetchAt: null,
  error: null,

  ingest: (incoming, contributors) =>
    set((state) => {
      const events = new Map(state.events);
      for (const event of incoming) events.set(event.id, event);
      return { events, contributors, lastFetchAt: Date.now(), error: null };
    }),

  setError: (error) => set({ error }),
  reset: () => set({ events: new Map(), contributors: [], lastFetchAt: null, error: null }),
}));
