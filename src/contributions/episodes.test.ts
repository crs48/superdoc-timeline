import { describe, expect, it } from 'vitest';
import { EPISODE_MAX_GAP_MS, buildLineage, buildRowResolver, foldEpisodes } from './episodes';
import type { BlockText, BurstChange } from '@/spotlight/burstDiff';
import type { BurstPlacement } from '@/spotlight/placementIndex';
import type { ContributionEvent } from '@/types';

const MIN = 60_000;

function burst(
  contributorId: string,
  startedAt: number,
  weight = 1,
  endedAt = startedAt,
): ContributionEvent {
  return { id: `${contributorId}:${startedAt}:${endedAt}`, contributorId, startedAt, endedAt, weight };
}

function placed(blockIds: string[]): (id: string) => BurstPlacement | undefined {
  return (burstId) => ({
    burstId,
    changes: blockIds.map<BurstChange>((blockId) => ({ blockId, offset: 0, inserted: 'x', deleted: '' })),
  });
}

function placementTable(
  table: Record<string, string[]>,
): (id: string) => BurstPlacement | undefined {
  return (burstId) => {
    const blocks = table[burstId];
    if (!blocks) return undefined;
    return placed(blocks)(burstId);
  };
}

describe('foldEpisodes', () => {
  it('merges same-author bursts in the same block across pauses longer than the burst gap', () => {
    // Three sentences with minute-long thinking pauses — one act of writing.
    const bursts = [burst('alice', 0), burst('alice', 2 * MIN), burst('alice', 5 * MIN)];
    const episodes = foldEpisodes(bursts, placed(['b1']));
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.burstCount).toBe(3);
    expect([...(episodes[0]?.blockIds ?? [])]).toEqual(['b1']);
  });

  it('splits when the pause exceeds EPISODE_MAX_GAP_MS even in the same block', () => {
    const bursts = [burst('alice', 0), burst('alice', EPISODE_MAX_GAP_MS + MIN)];
    expect(foldEpisodes(bursts, placed(['b1']))).toHaveLength(2);
  });

  it('splits when the author moves to a disjoint block', () => {
    const placements = placementTable({
      'alice:0:0': ['intro'],
      [`alice:${MIN}:${MIN}`]: ['outro'],
    });
    const episodes = foldEpisodes([burst('alice', 0), burst('alice', MIN)], placements);
    expect(episodes).toHaveLength(2);
  });

  it('keeps per-author episodes open across another author\'s interleaved bursts', () => {
    // Alice and Bob alternate in the same block: one episode each, overlapping
    // in time — concurrency is shown by the map, not flattened by the fold.
    const bursts = [
      burst('alice', 0),
      burst('bob', 1 * MIN),
      burst('alice', 2 * MIN),
      burst('bob', 3 * MIN),
    ];
    const episodes = foldEpisodes(bursts, placed(['shared']));
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e) => e.burstCount)).toEqual([2, 2]);
  });

  it('treats unplaced bursts as unknown, not as a different place', () => {
    const placements = placementTable({ 'alice:0:0': ['b1'] });
    // Second burst has no placement yet — it continues the episode on time.
    const episodes = foldEpisodes([burst('alice', 0), burst('alice', MIN)], placements);
    expect(episodes).toHaveLength(1);
  });

  it('reconciles: episode weights always sum to burst weights (R8)', () => {
    const bursts = [
      burst('alice', 0, 3),
      burst('bob', MIN, 5),
      burst('alice', 2 * MIN, 2),
      burst('alice', EPISODE_MAX_GAP_MS * 2, 7),
    ];
    const episodes = foldEpisodes(bursts, placed(['b1']));
    const episodeSum = episodes.reduce((sum, e) => sum + e.weight, 0);
    const burstSum = bursts.reduce((sum, b) => sum + b.weight, 0);
    expect(episodeSum).toBe(burstSum);
  });

  it('folds a paragraph split back onto its parent row via lineage (R3)', () => {
    const blocks: BlockText[] = [
      { blockId: 'parent', text: 'first half', splitFromBlockId: null, mergedIntoBlockId: null },
      { blockId: 'child', text: 'second half', splitFromBlockId: 'parent', mergedIntoBlockId: null },
    ];
    const canonicalOf = buildLineage(blocks);
    const placements = placementTable({
      'alice:0:0': ['parent'],
      [`alice:${MIN}:${MIN}`]: ['child'],
    });
    const episodes = foldEpisodes(
      [burst('alice', 0), burst('alice', MIN)],
      placements,
      canonicalOf,
    );
    expect(episodes).toHaveLength(1);
    // Continuity is judged in root space; the raw ids are both preserved so
    // the map can still place them on their own live rows.
    expect([...(episodes[0]?.blockIds ?? [])].sort()).toEqual(['child', 'parent']);
  });
});

describe('buildRowResolver', () => {
  const blocks: BlockText[] = [
    { blockId: 'intro', text: 'x', splitFromBlockId: null, mergedIntoBlockId: null },
    { blockId: 'body', text: 'y', splitFromBlockId: 'dead-seed', mergedIntoBlockId: null },
  ];

  it('keeps live blocks as their own rows even when they share an ancestor', () => {
    const rowOf = buildRowResolver(blocks);
    expect(rowOf('intro')).toBe('intro');
    expect(rowOf('body')).toBe('body');
  });

  it('resolves a dead id to its surviving split-descendant', () => {
    const rowOf = buildRowResolver(blocks);
    expect(rowOf('dead-seed')).toBe('body');
  });

  it('returns null for an id with no surviving descendant', () => {
    const rowOf = buildRowResolver(blocks);
    expect(rowOf('long-gone')).toBeNull();
  });
});

describe('buildLineage', () => {
  it('follows split chains to the root and leaves unknown ids alone', () => {
    const blocks: BlockText[] = [
      { blockId: 'a', text: '', splitFromBlockId: null, mergedIntoBlockId: null },
      { blockId: 'b', text: '', splitFromBlockId: 'a', mergedIntoBlockId: null },
      { blockId: 'c', text: '', splitFromBlockId: 'b', mergedIntoBlockId: null },
    ];
    const canonicalOf = buildLineage(blocks);
    expect(canonicalOf('c')).toBe('a');
    expect(canonicalOf('b')).toBe('a');
    expect(canonicalOf('unrelated')).toBe('unrelated');
  });

  it('survives a lineage cycle without hanging', () => {
    const blocks: BlockText[] = [
      { blockId: 'a', text: '', splitFromBlockId: 'b', mergedIntoBlockId: null },
      { blockId: 'b', text: '', splitFromBlockId: 'a', mergedIntoBlockId: null },
    ];
    const canonicalOf = buildLineage(blocks);
    expect(typeof canonicalOf('a')).toBe('string');
  });
});
