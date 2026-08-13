import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ActivitySeries } from '@/types';

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Pure: series in, chart out. Fetching and lifecycle belong to EditsPanel. */
export function ContributionChart({ series }: { series: ActivitySeries }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={series.buckets} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[series.from, series.to]}
          tickFormatter={clock}
          tick={{ fontSize: 11 }}
        />
        <YAxis allowDecimals={false} width={40} tick={{ fontSize: 11 }} />
        <Tooltip
          labelFormatter={(label) => (typeof label === 'number' ? clock(label) : String(label ?? ''))}
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
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
