import { describe, expect, it } from 'vitest';
import { chooseBucketMs, toSeries } from './bucket';
import type { Contributor, ContributionEvent } from '@/types';

const alice: Contributor = { id: 'a', name: 'Alice', color: '#000' };
const bob: Contributor = { id: 'b', name: 'Bob', color: '#111' };

function event(id: string, at: number, weight = 1): ContributionEvent {
  return { id: `${id}:${at}`, contributorId: id, startedAt: at, endedAt: at, weight };
}

describe('chooseBucketMs', () => {
  it('never goes below the 5s floor', () => {
    expect(chooseBucketMs(0)).toBeGreaterThanOrEqual(5_000);
    expect(chooseBucketMs(1_000)).toBeGreaterThanOrEqual(5_000);
  });

  it('is a power of two, so the axis does not re-scale between polls', () => {
    for (const span of [60_000, 3_600_000, 86_400_000]) {
      const ms = chooseBucketMs(span);
      expect(Number.isInteger(Math.log2(ms))).toBe(true);
    }
  });
});

describe('toSeries', () => {
  it('returns an empty series rather than throwing on no events', () => {
    const series = toSeries([], [alice], 1_000);
    expect(series.buckets).toEqual([]);
    expect(series.contributors).toEqual([alice]);
  });

  it('sums weights per contributor within a bucket', () => {
    const now = 100_000;
    const series = toSeries([event('a', 0), event('a', 1_000), event('b', 2_000)], [alice, bob], now);
    const first = series.buckets[0]!;
    expect(first.a).toBe(2);
    expect(first.b).toBe(1);
  });

  it('zero-fills every contributor in every bucket, including quiet ones', () => {
    // One burst at t=0 and one an hour later: the buckets between must exist
    // and be 0 for both contributors, or the stacked area renders as a tear.
    const hour = 3_600_000;
    const series = toSeries([event('a', 0), event('b', hour)], [alice, bob], hour);

    expect(series.buckets.length).toBeGreaterThan(2);
    for (const bucket of series.buckets) {
      expect(typeof bucket.a).toBe('number');
      expect(typeof bucket.b).toBe('number');
    }
    const totalA = series.buckets.reduce((sum, b) => sum + (b.a ?? 0), 0);
    const totalB = series.buckets.reduce((sum, b) => sum + (b.b ?? 0), 0);
    expect(totalA).toBe(1);
    expect(totalB).toBe(1);
  });

  it('keeps the axis domain covering the events it was given', () => {
    const series = toSeries([event('a', 10_000), event('a', 50_000)], [alice], 60_000);
    expect(series.from).toBeLessThanOrEqual(10_000);
    expect(series.to).toBeGreaterThanOrEqual(50_000);
  });
});
