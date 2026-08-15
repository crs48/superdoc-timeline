import { describe, expect, it } from 'vitest';
import {
  MIN_BURST_PX,
  SEAM_PX,
  SESSION_GAP_MS,
  columnOf,
  layoutSessions,
  mergeSessions,
  sessionColumns,
  tOf,
  xOf,
} from './sessions';

const MIN = 60_000;
const span = (startedAt: number, endedAt: number) => ({ startedAt, endedAt });

describe('mergeSessions', () => {
  it('keeps spans within the gap in one session', () => {
    const sessions = mergeSessions([
      span(0, MIN),
      span(MIN + SESSION_GAP_MS - 1, MIN + SESSION_GAP_MS),
    ]);
    expect(sessions).toHaveLength(1);
  });

  it('splits on gaps beyond the threshold', () => {
    expect(mergeSessions([span(0, MIN), span(MIN + SESSION_GAP_MS + 1, 10 * MIN)])).toHaveLength(2);
  });
});

describe('layoutSessions', () => {
  it('returns no segments for no activity', () => {
    expect(layoutSessions([], [], 800).segments).toEqual([]);
  });

  it('stretches a small history to fill the container exactly', () => {
    const { contentW, segments } = layoutSessions([span(0, 2 * MIN)], [span(0, 0)], 800);
    expect(contentW).toBe(800);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: 'session', x0: 0, x1: 800 });
  });

  it('cuts idle gaps into fixed seams and keeps widths duration-proportional', () => {
    const { contentW, segments } = layoutSessions(
      [span(0, 5 * MIN), span(60 * MIN, 70 * MIN)],
      [],
      1000,
    );
    expect(contentW).toBe(1000);
    expect(segments.map((s) => s.kind)).toEqual(['session', 'cut', 'session']);
    expect(segments[1]!.x1 - segments[1]!.x0).toBe(SEAM_PX);
    const w0 = segments[0]!.x1 - segments[0]!.x0;
    const w2 = segments[2]!.x1 - segments[2]!.x0;
    // 10 active minutes gets more room than 5.
    expect(w2).toBeGreaterThan(w0);
    expect(segments[2]!.x1).toBe(1000);
  });

  it('grows past the container when budgets demand it (elastic width)', () => {
    const spans = Array.from({ length: 10 }, (_, i) => span(i * 60 * MIN, i * 60 * MIN + 10 * MIN));
    const { contentW } = layoutSessions(spans, [], 300);
    expect(contentW).toBeGreaterThan(300);
  });

  it('gives a burst-dense session at least MIN_BURST_PX per burst', () => {
    const bursts = Array.from({ length: 30 }, (_, i) => span(i * 1000, i * 1000));
    const { contentW, segments } = layoutSessions([span(0, 30_000)], bursts, 100);
    const sessionW = segments[0]!.x1 - segments[0]!.x0;
    expect(sessionW).toBeGreaterThanOrEqual(30 * MIN_BURST_PX);
    expect(contentW).toBeGreaterThanOrEqual(30 * MIN_BURST_PX);
  });
});

describe('xOf / tOf (px space)', () => {
  const { segments } = layoutSessions(
    [span(0, 10 * MIN), span(60 * MIN, 65 * MIN)],
    [],
    900,
  );

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
    expect(tOf((cut.x0 + cut.x1) / 2, segments)).toBe(cut.t1);
  });

  it('clamps out-of-range inputs to the axis ends', () => {
    expect(xOf(-MIN, segments)).toBe(0);
    expect(tOf(-5, segments)).toBe(0);
    expect(tOf(10_000, segments)).toBe(65 * MIN);
  });
});

describe('sessionColumns / columnOf', () => {
  const { segments } = layoutSessions(
    [span(0, 10 * MIN), span(60 * MIN, 65 * MIN)],
    [],
    900,
  );

  it('returns only the session segments, in axis order', () => {
    const cols = sessionColumns(segments);
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => c.kind)).toEqual(['session', 'session']);
    expect(cols[0]!.t0).toBe(0);
    expect(cols[1]!.t0).toBe(60 * MIN);
  });

  it('places a time in its column and a seam time in none', () => {
    const cols = sessionColumns(segments);
    expect(columnOf(4 * MIN, cols)).toBe(0);
    expect(columnOf(65 * MIN, cols)).toBe(1);
    expect(columnOf(30 * MIN, cols)).toBe(-1);
  });
});
