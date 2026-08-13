import { useMemo } from 'react';
import { formatClock } from '@/lib/time';
import type { BrushWindow } from './ContributionChart';
import type { ActivitySeries } from '@/types';

interface SummaryCardProps {
  series: ActivitySeries;
  /** null = the full series (no brush yet, or brush hidden). */
  window: BrushWindow | null;
}

/**
 * Per-contributor totals for the brushed window. Derived entirely from the
 * bucketed series — the same numbers the chart draws — so the card can never
 * disagree with the picture above it.
 */
export function SummaryCard({ series, window }: SummaryCardProps) {
  const summary = useMemo(() => {
    const last = series.buckets.length - 1;
    if (last < 0) return null;
    // The poll appends buckets while a brush is set; clamp rather than crash.
    const start = Math.max(0, Math.min(window?.startIndex ?? 0, last));
    const end = Math.max(start, Math.min(window?.endIndex ?? last, last));

    const slice = series.buckets.slice(start, end + 1);
    const totals = series.contributors.map((contributor) => ({
      contributor,
      chars: slice.reduce((sum, bucket) => sum + (bucket[contributor.id] ?? 0), 0),
    }));
    const total = totals.reduce((sum, entry) => sum + entry.chars, 0);
    const firstBucket = slice[0];
    const lastBucket = slice[slice.length - 1];

    return {
      totals: totals.sort((a, b) => b.chars - a.chars),
      total,
      from: firstBucket ? firstBucket.t : series.from,
      to: lastBucket ? lastBucket.t + series.bucketMs : series.to,
      windowed: window != null,
    };
  }, [series, window]);

  if (!summary) return null;

  return (
    <div className="mx-2 mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {summary.windowed ? 'Selected window' : 'All activity'} · {formatClock(summary.from)}–
        {formatClock(summary.to)} · {summary.total} bursts
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {summary.totals.map(({ contributor, chars }) => (
          <li key={contributor.id} className="flex items-center gap-1.5 text-xs text-slate-700">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: contributor.color }}
            />
            <span className="font-medium">{contributor.name}</span>
            <span className="tabular-nums text-slate-500">
              {chars} ({summary.total > 0 ? Math.round((chars / summary.total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
