import { create } from 'zustand';
import type { Contributor, ContributionEvent } from '@/types';
// Type-only imports: the runtime dependency runs the other way (the
// placement backfill writes into this store).
import type { BlockText } from '@/spotlight/burstDiff';
import type { BurstPlacement } from '@/spotlight/placementIndex';

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
  /**
   * Where each burst landed, keyed by burst id. Filled incrementally by the
   * placement backfill; an absent entry means "not located yet", an entry
   * with empty changes means "located: no story text changed".
   */
  placements: Map<string, BurstPlacement>;
  /** Story blocks of the most recent reconstruction — the map's y-axis rows. */
  latestBlocks: BlockText[] | null;

  ingest: (events: ContributionEvent[], contributors: Contributor[]) => void;
  putPlacement: (placement: BurstPlacement) => void;
  setLatestBlocks: (blocks: BlockText[]) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useActivity = create<ActivityState>()((set) => ({
  events: new Map(),
  contributors: [],
  lastFetchAt: null,
  error: null,
  placements: new Map(),
  latestBlocks: null,

  ingest: (incoming, contributors) =>
    set((state) => {
      const events = new Map(state.events);
      for (const event of incoming) events.set(event.id, event);
      return { events, contributors, lastFetchAt: Date.now(), error: null };
    }),

  putPlacement: (placement) =>
    set((state) => {
      const placements = new Map(state.placements);
      placements.set(placement.burstId, placement);
      return { placements };
    }),

  setLatestBlocks: (latestBlocks) => set({ latestBlocks }),

  setError: (error) => set({ error }),
  reset: () =>
    set({
      events: new Map(),
      contributors: [],
      lastFetchAt: null,
      error: null,
      placements: new Map(),
      latestBlocks: null,
    }),
}));
