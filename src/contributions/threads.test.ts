import { describe, expect, it } from 'vitest';
import type { TimeSegment } from './sessions';
import {
  THREAD_UNPLACED_ROW_KEY,
  buildThreads,
  sweepThreshold,
  typeCell,
  type ThreadBurst,
} from './threads';

const MIN = 60_000;

/** N session columns, each 10 min long, 1 h apart. */
function columns(n: number): TimeSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    t0: i * 60 * MIN,
    t1: i * 60 * MIN + 10 * MIN,
    x0: i * 100,
    x1: i * 100 + 80,
    kind: 'session' as const,
  }));
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `s${i}` }));
const inSession = (i: number) => i * 60 * MIN + 5 * MIN;

/** A burst spread evenly over the given rows. */
function burst(
  contributorId: string,
  session: number,
  rowKeys: string[],
  weight = 10,
): ThreadBurst {
  return {
    contributorId,
    startedAt: inSession(session),
    weight,
    rows: rowKeys.map((rowKey) => ({ rowKey, share: 1 / rowKeys.length })),
  };
}

describe('sweepThreshold', () => {
  it('is half the rows, never below three', () => {
    expect(sweepThreshold(3)).toBe(3);
    expect(sweepThreshold(4)).toBe(3);
    expect(sweepThreshold(6)).toBe(3);
    expect(sweepThreshold(8)).toBe(4);
    expect(sweepThreshold(12)).toBe(6);
  });
});

describe('typeCell', () => {
  const rowIndex = new Map(rowsOf(8).map((r, i) => [r.key, i]));

  it('picks the heaviest row for a focus node, not the median', () => {
    const typed = typeCell(new Map([['s1', 1], ['s2', 9]]), rowIndex, 8);
    expect(typed).toMatchObject({ kind: 'focus', rowIndex: 2, weight: 10 });
  });

  it('V7: unplaced weight counts toward volume but never toward sweep typing', () => {
    const typed = typeCell(new Map([['s0', 1], [THREAD_UNPLACED_ROW_KEY, 99]]), rowIndex, 8);
    expect(typed).toMatchObject({ kind: 'focus', rowIndex: 0, weight: 100 });
    // Only unplaced → no location at all → no node.
    expect(typeCell(new Map([[THREAD_UNPLACED_ROW_KEY, 5]]), rowIndex, 8)).toBeNull();
  });
});

describe('buildThreads — node typing', () => {
  it('V3: a burst over all 6 of 6 rows is ONE sweep node carrying the event weight once', () => {
    const rows = rowsOf(6);
    const geo = buildThreads([burst('a', 0, rows.map((r) => r.key), 42)], rows, columns(1));
    expect(geo.threads).toHaveLength(1);
    const [node] = geo.threads[0]!.nodes;
    expect(node).toMatchObject({ kind: 'sweep', rowKey0: 's0', rowKey1: 's5' });
    expect(node!.weight).toBeCloseTo(42, 6);
    expect(geo.threads[0]!.weight).toBeCloseTo(42, 6);
  });

  it('V4: with 3 rows nothing is ever a sweep', () => {
    const rows = rowsOf(3);
    const geo = buildThreads([burst('a', 0, ['s0', 's1', 's2'])], rows, columns(1));
    expect(geo.threads[0]!.nodes[0]!.kind).toBe('focus');
  });

  it('V4: with 8 rows a 3-row episode is focus and a 4-row episode is sweep', () => {
    const rows = rowsOf(8);
    const focus = buildThreads([burst('a', 0, ['s2', 's3', 's4'])], rows, columns(1));
    expect(focus.threads[0]!.nodes[0]!.kind).toBe('focus');
    const sweep = buildThreads([burst('a', 0, ['s2', 's3', 's4', 's5'])], rows, columns(1));
    expect(sweep.threads[0]!.nodes[0]!.kind).toBe('sweep');
    // Span counts too: rows 0 and 3 touched → span 4 → sweep.
    const spanning = buildThreads([burst('a', 0, ['s0', 's3'])], rows, columns(1));
    expect(spanning.threads[0]!.nodes[0]!.kind).toBe('sweep');
  });
});

describe('buildThreads — links and lanes', () => {
  it('V5: absence for sessions 1–3 yields exactly one dormant link', () => {
    const rows = rowsOf(4);
    const geo = buildThreads(
      [burst('a', 0, ['s0']), burst('a', 4, ['s0'])],
      rows,
      columns(5),
    );
    const thread = geo.threads[0]!;
    expect(thread.nodes).toHaveLength(2);
    expect(thread.links).toEqual([{ from: 0, to: 1, dormant: true }]);
  });

  it('adjacent sessions link solidly', () => {
    const rows = rowsOf(4);
    const geo = buildThreads([burst('a', 0, ['s0']), burst('a', 1, ['s1'])], rows, columns(2));
    expect(geo.threads[0]!.links).toEqual([{ from: 0, to: 1, dormant: false }]);
  });

  it('V6: co-present contributors get distinct lanes ordered by where they came from', () => {
    const rows = rowsOf(4);
    // Session 0: a is at row 0 (top), b at row 3 (bottom). Session 1: both at row 2.
    const geo = buildThreads(
      [
        burst('a', 0, ['s0']),
        burst('b', 0, ['s3']),
        burst('a', 1, ['s2']),
        burst('b', 1, ['s2']),
      ],
      rows,
      columns(2),
    );
    const at = (id: string) => geo.threads.find((t) => t.contributorId === id)!.nodes[1]!;
    const a = at('a'), b = at('b');
    expect(a.kind).toBe('focus');
    expect(b.kind).toBe('focus');
    if (a.kind === 'focus' && b.kind === 'focus') {
      expect(a.laneCount).toBe(2);
      expect(b.laneCount).toBe(2);
      expect(a.lane).toBe(0); // came from above → upper lane
      expect(b.lane).toBe(1); // came from below → lower lane
    }
  });

  it('a lone thread in a row occupies lane 0 of 1', () => {
    const rows = rowsOf(4);
    const geo = buildThreads([burst('a', 0, ['s1'])], rows, columns(1));
    expect(geo.threads[0]!.nodes[0]).toMatchObject({ kind: 'focus', lane: 0, laneCount: 1 });
  });
});

describe('buildThreads — filtering', () => {
  it('bursts inside a collapsed seam do not create nodes', () => {
    const rows = rowsOf(4);
    const geo = buildThreads(
      [{ contributorId: 'a', startedAt: 30 * MIN, weight: 5, rows: [{ rowKey: 's0', share: 1 }] }],
      rows,
      columns(2),
    );
    expect(geo.threads).toHaveLength(0);
  });

  it('hidden contributors are dropped entirely; top-N reports the omitted', () => {
    const rows = rowsOf(4);
    const bursts = [
      burst('a', 0, ['s0'], 100),
      burst('b', 0, ['s1'], 50),
      burst('c', 0, ['s2'], 10),
    ];
    const hidden = buildThreads(bursts, rows, columns(1), { hidden: new Set(['b']) });
    expect(hidden.threads.map((t) => t.contributorId)).toEqual(['a', 'c']);
    expect(hidden.omitted).toEqual([]);

    const top = buildThreads(bursts, rows, columns(1), { topN: 2 });
    expect(top.threads.map((t) => t.contributorId)).toEqual(['a', 'b']);
    expect(top.omitted).toEqual(['c']);
  });

  it('threads are ordered by total weight, and maxNodeWeight is the largest node', () => {
    const rows = rowsOf(4);
    const geo = buildThreads(
      [burst('a', 0, ['s0'], 3), burst('b', 0, ['s1'], 30), burst('b', 1, ['s1'], 1)],
      rows,
      columns(2),
    );
    expect(geo.threads.map((t) => t.contributorId)).toEqual(['b', 'a']);
    expect(geo.maxNodeWeight).toBe(30);
  });
});
