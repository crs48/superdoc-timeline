import { memo } from 'react';
import { Area, AreaChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatClock } from '@/lib/time';
import type { ActivitySeries } from '@/types';

/** Inclusive bucket-index window reported by the brush. */
export interface BrushWindow {
  startIndex: number;
  endIndex: number;
}

interface ContributionChartProps {
  series: ActivitySeries;
  /** Contributors whose bands are hidden (legend solo/focus). */
  hiddenIds?: ReadonlySet<string>;
  /**
   * Fires as the user drags the brush. The Brush is deliberately UNCONTROLLED —
   * its startIndex/endIndex props are widely reported not to take effect
   * without a remount (recharts#2404, #425) — so indices flow out only.
   */
  onBrushChange?: (window: BrushWindow) => void;
  /** Hidden for sparse series, where a brush over two points is noise. */
  showBrush?: boolean;
  /** History Mode: click a bucket to jump to that moment. */
  onBucketClick?: (t: number) => void;
}

export const ContributionChart = memo(function ContributionChart({
  series,
  hiddenIds,
  onBrushChange,
  showBrush = false,
  onBucketClick,
}: ContributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={showBrush ? 250 : 220}>
      <AreaChart
        data={series.buckets}
        margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        onClick={
          onBucketClick
            ? (state) => {
                const label = state?.activeLabel;
                // Jump to the bucket's END: clicking a peak should show the
                // document *including* that burst, not the instant before it.
                if (typeof label === 'number') onBucketClick(label + series.bucketMs);
              }
            : undefined
        }
        style={onBucketClick ? { cursor: 'pointer' } : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[series.from, series.to]}
          tickFormatter={formatClock}
          tick={{ fontSize: 11 }}
        />
        <YAxis allowDecimals={false} width={40} tick={{ fontSize: 11 }} />
        <Tooltip
          labelFormatter={(label) =>
            typeof label === 'number' ? formatClock(label) : String(label ?? '')
          }
          formatter={(value, name) => [`${String(value ?? 0)} bursts`, String(name ?? '')]}
          contentStyle={{ fontSize: 12 }}
        />
        {series.contributors.map((contributor) => (
          <Area
            key={contributor.id}
            type="monotone"
            dataKey={contributor.id}
            name={contributor.name}
            stackId="contributions"
            stroke={contributor.color}
            fill={contributor.color}
            fillOpacity={0.55}
            isAnimationActive={false}
            hide={hiddenIds?.has(contributor.id) ?? false}
          />
        ))}
        {showBrush ? (
          <Brush
            dataKey="t"
            height={24}
            travellerWidth={8}
            stroke="#94a3b8"
            tickFormatter={formatClock}
            onChange={(window) => {
              const { startIndex, endIndex } = window ?? {};
              if (typeof startIndex === 'number' && typeof endIndex === 'number') {
                onBrushChange?.({ startIndex, endIndex });
              }
            }}
          />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  );
});
