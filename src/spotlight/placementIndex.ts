import { useEffect } from 'react';
import { blocksAt, diffForBurst, type BurstChange } from './burstDiff';
import { useActivity } from '@/store/activity';
import type { ContributionEvent } from '@/types';

/**
 * Where one burst landed in the document. `changes: []` is a fetched,
 * definitive "no story text changed" — distinct from an absent entry, which
 * means "not located yet".
 */
export interface BurstPlacement {
  burstId: string;
  changes: BurstChange[];
}

/** Backfill cap (0004, R1): beyond this, old history stays volume-only. */
const MAX_PLACEMENTS = 500;
/** Two changeset fetches in flight keeps a cold backfill polite. */
const CONCURRENCY = 2;

/**
 * Locate every burst that doesn't have a placement yet, newest first so the
 * visible recent history lights up immediately. Placements are immutable once
 * computed; polling calls this repeatedly and it no-ops on anything known.
 */
export async function fillPlacements(
  roomId: string,
  bursts: ContributionEvent[],
  have: (burstId: string) => boolean,
  put: (placement: BurstPlacement) => void,
  signal?: AbortSignal,
): Promise<void> {
  const missing = bursts
    .filter((b) => !have(b.id))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, MAX_PLACEMENTS);
  const queue = missing[Symbol.iterator]();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (const burst of queue) {
        if (signal?.aborted) return;
        try {
          const changes = await diffForBurst(roomId, burst, signal);
          if (signal?.aborted) return;
          put({ burstId: burst.id, changes });
        } catch {
          // One failed reconstruction (abort, network) is not a reason to
          // stop locating the rest; the burst stays unplaced and a later
          // poll retries it.
        }
      }
    }),
  );
}

/**
 * Keeps the placement index and the latest block list in step with the
 * activity store. The map renders progressively as placements arrive.
 */
export function usePlacementBackfill(roomId: string | null, enabled: boolean) {
  const events = useActivity((s) => s.events);
  const putPlacement = useActivity((s) => s.putPlacement);
  const setLatestBlocks = useActivity((s) => s.setLatestBlocks);

  useEffect(() => {
    if (!roomId || !enabled || events.size === 0) return;
    const controller = new AbortController();
    const bursts = [...events.values()];

    const newest = bursts.reduce((a, b) => (b.endedAt > a.endedAt ? b : a));
    void blocksAt(roomId, newest.endedAt, controller.signal)
      .then((blocks) => {
        if (!controller.signal.aborted) setLatestBlocks(blocks);
      })
      .catch(() => {});

    void fillPlacements(
      roomId,
      bursts,
      (id) => useActivity.getState().placements.has(id),
      putPlacement,
      controller.signal,
    );

    return () => controller.abort();
  }, [roomId, enabled, events, putPlacement, setLatestBlocks]);
}
