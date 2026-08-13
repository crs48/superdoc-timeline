import type { ActivityBucket, ActivitySeries, Contributor, ContributionEvent } from '@/types';

const MIN_BUCKET_MS = 5_000;
const TARGET_BUCKETS = 60;
/** Guard against a pathological span producing millions of empty buckets. */
const MAX_BUCKETS = 400;

/**
 * Snap the bucket width to a power of two so the x-axis does not re-scale on
 * every poll — a chart whose gridlines jump each tick reads as broken.
 */
export function chooseBucketMs(spanMs: number): number {
  const ideal = Math.max(MIN_BUCKET_MS, spanMs / TARGET_BUCKETS);
  return 2 ** Math.ceil(Math.log2(ideal));
}

export function toSeries(
  events: ContributionEvent[],
  contributors: Contributor[],
  now: number = Date.now(),
): ActivitySeries {
  if (events.length === 0) {
    return { bucketMs: MIN_BUCKET_MS, buckets: [], contributors, from: now, to: now };
  }

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = now;
  for (const event of events) {
    if (event.startedAt < minStart) minStart = event.startedAt;
    if (event.endedAt > maxEnd) maxEnd = event.endedAt;
  }

  const bucketMs = chooseBucketMs(maxEnd - minStart);
  const start = Math.floor(minStart / bucketMs) * bucketMs;

  // Zero-fill every contributor in every bucket: a stacked area chart with
  // missing keys renders as a torn ribbon, which reads as data loss.
  const buckets = new Map<number, ActivityBucket>();
  let count = 0;
  for (let t = start; t <= maxEnd && count < MAX_BUCKETS; t += bucketMs, count += 1) {
    const bucket = { t } as ActivityBucket;
    for (const contributor of contributors) bucket[contributor.id] = 0;
    buckets.set(t, bucket);
  }

  for (const event of events) {
    const t = Math.floor(event.startedAt / bucketMs) * bucketMs;
    const bucket = buckets.get(t);
    if (!bucket) continue;
    bucket[event.contributorId] = (bucket[event.contributorId] ?? 0) + event.weight;
  }

  return {
    bucketMs,
    buckets: [...buckets.values()],
    contributors,
    from: start,
    to: Math.max(maxEnd, start + bucketMs),
  };
}
