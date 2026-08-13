import { ContributionChart } from './ContributionChart';
import { useActivity } from '@/store/activity';
import type { ActivitySeries } from '@/types';

interface EditsPanelProps {
  series: ActivitySeries;
  connected: boolean;
}

export function EditsPanel({ series, connected }: EditsPanelProps) {
  const error = useActivity((s) => s.error);
  const lastFetchAt = useActivity((s) => s.lastFetchAt);
  const hasData = series.buckets.length > 0;

  return (
    <section className="border-t border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Edits over time</h2>
          <p className="text-xs text-slate-500">
            Characters edited per contributor, recorded by the collaboration server.
          </p>
        </div>
        <ul className="flex flex-wrap gap-3">
          {series.contributors.map((contributor) => (
            <li key={contributor.id} className="flex items-center gap-1.5 text-xs text-slate-700">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: contributor.color }}
              />
              {contributor.name}
            </li>
          ))}
        </ul>
      </header>

      <div className="px-2 pb-3 pt-2">
        {error ? (
          <p className="px-2 py-8 text-center text-xs text-amber-700">
            Activity is unavailable ({error}). The document keeps working.
          </p>
        ) : hasData ? (
          // Recharts' ResponsiveContainer grows reliably but does not always
          // shrink with the viewport; scrolling the chart inside its own
          // container keeps a narrow page from overflowing horizontally.
          <div className="overflow-x-auto">
            <ContributionChart series={series} />
          </div>
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
