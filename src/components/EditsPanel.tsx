import { useState } from 'react';
import { ContributionChart, type BrushWindow } from './ContributionChart';
import { SummaryCard } from './SummaryCard';
import { useActivity } from '@/store/activity';
import type { ActivitySeries } from '@/types';

interface EditsPanelProps {
  series: ActivitySeries;
  connected: boolean;
  /** History Mode: forwarded to the chart's bucket click. */
  onBucketClick?: (t: number) => void;
}

/** Below this many buckets a brush is noise — show the plain chart. */
const MIN_BUCKETS_FOR_BRUSH = 8;

export function EditsPanel({ series, connected, onBucketClick }: EditsPanelProps) {
  const error = useActivity((s) => s.error);
  const lastFetchAt = useActivity((s) => s.lastFetchAt);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [brush, setBrush] = useState<BrushWindow | null>(null);

  const hasData = series.buckets.length > 0;
  const sparse = hasData && series.buckets.length < MIN_BUCKETS_FOR_BRUSH;

  const toggleContributor = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="border-t border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Edits over time</h2>
          <p className="text-xs text-slate-500">
            Edit bursts per contributor, recorded by the collaboration server.
            {onBucketClick ? ' Click the chart to view the document at that moment.' : ''}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1">
          {series.contributors.map((contributor) => {
            const hidden = hiddenIds.has(contributor.id);
            return (
              <li key={contributor.id}>
                <button
                  type="button"
                  onClick={() => toggleContributor(contributor.id)}
                  aria-pressed={!hidden}
                  title={hidden ? `Show ${contributor.name}` : `Hide ${contributor.name}`}
                  className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-opacity hover:bg-slate-100 ${
                    hidden ? 'opacity-40' : 'text-slate-700'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: contributor.color }}
                  />
                  <span className={hidden ? 'line-through' : ''}>{contributor.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </header>

      <div className="px-2 pb-3 pt-2">
        {error ? (
          <p className="px-2 py-8 text-center text-xs text-amber-700">
            Activity is unavailable ({error}). The document keeps working.
          </p>
        ) : hasData ? (
          <>
            {/* Recharts' ResponsiveContainer grows reliably but does not always
                shrink with the viewport; scrolling the chart inside its own
                container keeps a narrow page from overflowing horizontally. */}
            <div className="overflow-x-auto">
              <ContributionChart
                series={series}
                hiddenIds={hiddenIds}
                showBrush={!sparse}
                onBrushChange={setBrush}
                onBucketClick={onBucketClick}
              />
            </div>
            {sparse ? (
              <p className="px-2 pb-1 text-center text-[11px] text-slate-400">
                Not much activity yet — the timeline fills in as edits accumulate.
              </p>
            ) : null}
            <SummaryCard series={series} window={sparse ? null : brush} />
          </>
        ) : (
          <p className="px-2 py-8 text-center text-xs text-slate-500">
            {connected
              ? lastFetchAt
                ? 'No edits recorded yet. Type in the document to see activity appear.'
                : 'Loading activity…'
              : 'Waiting for the collaboration server…'}
          </p>
        )}
      </div>
    </section>
  );
}
