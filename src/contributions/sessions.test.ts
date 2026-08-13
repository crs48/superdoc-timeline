import { describe, expect, it } from 'vitest';
import { SESSION_GAP_MS, buildSegments, tOf, xOf } from './sessions';

const MIN = 60_000;

describe('buildSegments', () => {
  it('returns no segments for no activity', () => {
    expect(buildSegments([])).toEqual([]);
  });

  it('lays a single session across the full axis', () => {
    const segments = buildSegments([{ startedAt: 0, endedAt: 10 * MIN }]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: 'session', x0: 0, x1: 1 });
  });

  it('cuts a long idle gap into a fixed seam and still fills the width', () => {
    const segments = buildSegments([
      { startedAt: 0, endedAt: 5 * MIN },
      { startedAt: 60 * MIN, endedAt: 70 * MIN },
    ]);
    expect(segments.map((s) => s.kind)).toEqual(['session', 'cut', 'session']);
    const cut = segments[1]!;
    // The 55-minute gap costs a fixed sliver, not 55 minutes of width.
    expect(cut.x1 - cut.x0).toBeLessThan(0.05);
    expect(segments[2]!.x1).toBe(1);
    // Session widths are duration-proportional: 10min gets ~2x the 5min one.
    const w0 = segments[0]!.x1 - segments[0]!.x0;
    const w2 = segments[2]!.x1 - segments[2]!.x0;
    expect(w2).toBeGreaterThan(w0);
  });

  it('keeps spans within the session gap in one session', () => {
    const segments = buildSegments([
      { startedAt: 0, endedAt: MIN },
      { startedAt: MIN + SESSION_GAP_MS - 1, endedAt: MIN + SESSION_GAP_MS },
    ]);
    expect(segments).toHaveLength(1);
  });
});

describe('xOf / tOf', () => {
  const segments = buildSegments([
    { startedAt: 0, endedAt: 10 * MIN },
    { startedAt: 60 * MIN, endedAt: 65 * MIN },
  ]);

  it('round-trips times inside sessions', () => {
    for (const t of [0, 4 * MIN, 10 * MIN, 61 * MIN, 65 * MIN]) {
      expect(tOf(xOf(t, segments), segments)).toBeCloseTo(t, 5);
    }
  });

  it('clamps a time inside the cut to the seam edge', () => {
    const cut = segments.find((s) => s.kind === 'cut')!;
    expect(xOf(30 * MIN, segments)).toBe(cut.x1);
  });

  it('resolves an x inside the cut to the gap\'s end', () => {
    const cut = segments.find((s) => s.kind === 'cut')!;
    const mid = (cut.x0 + cut.x1) / 2;
    expect(tOf(mid, segments)).toBe(cut.t1);
  });

  it('clamps out-of-range inputs to the axis ends', () => {
    expect(xOf(-MIN, segments)).toBe(0);
    expect(xOf(120 * MIN, segments)).toBe(1);
    expect(tOf(-0.5, segments)).toBe(0);
    expect(tOf(1.5, segments)).toBe(65 * MIN);
  });
});
