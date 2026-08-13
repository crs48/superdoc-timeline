import type { BlockText } from '@/spotlight/burstDiff';
import type { BurstPlacement } from '@/spotlight/placementIndex';
import type { ContributionEvent, ContributorId } from '@/types';

/**
 * One act of writing: a maximal run of bursts by one contributor whose
 * touched blocks overlap, folded together across pauses. This is the unit a
 * human means by "I edited this paragraph" — something no time-gap threshold
 * can see, which is why it needs the placement index (exploration 0004).
 */
export interface EditEpisode {
  /** The first burst's id — stable, since bursts are immutable. */
  id: string;
  contributorId: ContributorId;
  /** Canonical block ids this episode touched. Empty = never placed. */
  blockIds: ReadonlySet<string>;
  startedAt: number;
  endedAt: number;
  /** Σ burst weights, so totals reconcile with the Volume tab (R8). */
  weight: number;
  burstCount: number;
}

/** A pause longer than this ends an episode even inside the same block. */
export const EPISODE_MAX_GAP_MS = 15 * 60_000;

/**
 * Canonical block identity across splits and merges (R3): pressing Enter
 * inside a paragraph mints a new blockId carrying `splitFromBlockId`, and a
 * join records `mergedIntoBlockId`. Following those links to their root keeps
 * one act of writing on one row. Unknown ids canonicalize to themselves.
 */
export function buildLineage(blocks: BlockText[]): (blockId: string) => string {
  const parent = new Map<string, string>();
  for (const block of blocks) {
    const link = block.splitFromBlockId ?? block.mergedIntoBlockId;
    if (link && link !== block.blockId) parent.set(block.blockId, link);
  }
  const canonical = new Map<string, string>();
  return function canonicalOf(blockId: string): string {
    const known = canonical.get(blockId);
    if (known) return known;
    let cursor = blockId;
    const seen = new Set<string>([cursor]);
    while (true) {
      const next = parent.get(cursor);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
    for (const id of seen) canonical.set(id, cursor);
    return cursor;
  };
}

interface OpenEpisode {
  id: string;
  contributorId: ContributorId;
  blocks: Set<string>;
  startedAt: number;
  endedAt: number;
  weight: number;
  burstCount: number;
}

function close(open: OpenEpisode): EditEpisode {
  const { blocks, ...rest } = open;
  return { ...rest, blockIds: blocks };
}

/**
 * Fold bursts into episodes. A burst continues its contributor's open
 * episode when the pause is short enough AND the touched blocks are
 * compatible: an intersection, or one side unplaced (an unlocated burst is
 * unknown, not evidence of a different place). Another contributor's
 * interleaved bursts never split an episode — concurrency is the map's job
 * to *show*, not the fold's job to hide.
 */
export function foldEpisodes(
  bursts: ContributionEvent[],
  placementOf: (burstId: string) => BurstPlacement | undefined,
  canonicalOf: (blockId: string) => string = (id) => id,
): EditEpisode[] {
  const sorted = [...bursts].sort((a, b) => a.startedAt - b.startedAt);
  const open = new Map<ContributorId, OpenEpisode>();
  const out: EditEpisode[] = [];

  for (const burst of sorted) {
    const touched = new Set(
      (placementOf(burst.id)?.changes ?? []).map((change) => canonicalOf(change.blockId)),
    );
    const current = open.get(burst.contributorId);
    const compatible =
      current != null &&
      burst.startedAt - current.endedAt <= EPISODE_MAX_GAP_MS &&
      (touched.size === 0 ||
        current.blocks.size === 0 ||
        [...touched].some((id) => current.blocks.has(id)));

    if (current && compatible) {
      current.endedAt = Math.max(current.endedAt, burst.endedAt);
      current.weight += burst.weight;
      current.burstCount += 1;
      for (const id of touched) current.blocks.add(id);
    } else {
      if (current) out.push(close(current));
      open.set(burst.contributorId, {
        id: burst.id,
        contributorId: burst.contributorId,
        blocks: touched,
        startedAt: burst.startedAt,
        endedAt: burst.endedAt,
        weight: burst.weight,
        burstCount: 1,
      });
    }
  }

  for (const current of open.values()) out.push(close(current));
  return out.sort((a, b) => a.startedAt - b.startedAt);
}
