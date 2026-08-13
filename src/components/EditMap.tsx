import { memo, useEffect, useRef, useState } from 'react';
import type { EditEpisode } from '@/contributions/episodes';
import { tOf, xOf, type TimeSegment } from '@/contributions/sessions';
import { colorForContributor } from '@/lib/color';
import { formatClock, formatDuration } from '@/lib/time';

/** One y-axis band. Weight is relative height (block text length, clamped). */
export interface MapRow {
  key: string;
  label: string;
  weight: number;
}

/** Synthetic row keys — the map draws these below the real blocks. */
export const REMOVED_ROW_KEY = '__removed__';
export const UNPLACED_ROW_KEY = '__unplaced__';

interface EditMapProps {
  episodes: EditEpisode[];
  segments: TimeSegment[];
  rows: MapRow[];
  /** Resolve an episode's display name (contributor name). */
  nameOf: (contributorId: string) => string;
  /** Click anywhere on the plot → the real time under the cursor. */
  onPickTime?: (t: number) => void;
  /** Reserved for the 0003 hover spotlight; no-op until it lands. */
  onHoverEpisode?: (episode: EditEpisode | null) => void;
}

const AXIS_H = 16;
const LABEL_W = 96;
const MIN_ROW_H = 12;
const MIN_MARK_W = 3;

/**
 * The space-time edit map (exploration 0004): document blocks on the y-axis,
 * gap-compressed sessions on the x-axis, one rectangle per episode colored by
 * contributor. Hand-rolled SVG — recharts has neither discontinuous scales
 * nor per-row rect series, and the data volumes here are tiny.
 */
export const EditMap = memo(function EditMap({
  episodes,
  segments,
  rows,
  nameOf,
  onPickTime,
  onHoverEpisode,
}: EditMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const labelW = width < 480 ? 0 : LABEL_W;
  const plotW = Math.max(width - labelW, 0);
  const plotH = Math.max(height - AXIS_H, 0);
  const ready = plotW > 40 && plotH > 30 && rows.length > 0 && segments.length > 0;

  // Row layout: proportional to weight with a floor, renormalized to fit —
  // the floor is best-effort when many rows meet a short dock.
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  let bands = rows.map((row) => ({ row, h: (row.weight / totalWeight) * plotH }));
  const clamped = bands.map((band) => ({ ...band, h: Math.max(band.h, MIN_ROW_H) }));
  const clampedTotal = clamped.reduce((sum, band) => sum + band.h, 0);
  bands = clamped.map((band) => ({ ...band, h: (band.h / clampedTotal) * plotH }));
  const rowY = new Map<string, { y: number; h: number }>();
  let y = 0;
  for (const band of bands) {
    rowY.set(band.row.key, { y, h: band.h });
    y += band.h;
  }

  const px = (frac: number) => labelW + frac * plotW;

  // Per-row greedy lane assignment so time-overlapping episodes on one block
  // split the row's height instead of hiding each other.
  const marks: Array<{
    episode: EditEpisode;
    rowKey: string;
    x: number;
    w: number;
    lane: number;
    lanes: number;
  }> = [];
  if (ready) {
    const byRow = new Map<string, Array<{ episode: EditEpisode; x: number; w: number }>>();
    for (const episode of [...episodes].sort((a, b) => a.startedAt - b.startedAt)) {
      const x0 = px(xOf(episode.startedAt, segments));
      const x1 = px(xOf(episode.endedAt, segments));
      const w = Math.max(x1 - x0, MIN_MARK_W);
      const rowKeys =
        episode.blockIds.size === 0
          ? [UNPLACED_ROW_KEY]
          : [...episode.blockIds].map((id) => (rowY.has(id) ? id : REMOVED_ROW_KEY));
      for (const rowKey of new Set(rowKeys)) {
        if (!rowY.has(rowKey)) continue;
        let list = byRow.get(rowKey);
        if (!list) byRow.set(rowKey, (list = []));
        list.push({ episode, x: x0, w });
      }
    }
    for (const [rowKey, list] of byRow) {
      const laneEnds: number[] = [];
      const assigned = list.map((item) => {
        let lane = laneEnds.findIndex((end) => end <= item.x);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = item.x + item.w;
        return { ...item, lane };
      });
      for (const item of assigned) {
        marks.push({ ...item, rowKey, lanes: laneEnds.length });
      }
    }
  }

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!onPickTime || !ready) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left - labelW) / plotW;
    if (frac < 0 || frac > 1) return;
    onPickTime(tOf(frac, segments));
  }

  return (
    <div ref={hostRef} className="h-full w-full">
      {ready ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Map of where and when each contributor edited"
          onClick={handleClick}
          style={onPickTime ? { cursor: 'pointer' } : undefined}
        >
          <defs>
            <pattern id="editmap-seam" patternUnits="userSpaceOnUse" width="6" height="6">
              <path d="M0 6 L6 0" stroke="#cbd5e1" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Row bands + labels */}
          {bands.map(({ row }, i) => {
            const band = rowY.get(row.key)!;
            const synthetic = row.key === REMOVED_ROW_KEY || row.key === UNPLACED_ROW_KEY;
            return (
              <g key={row.key}>
                <rect
                  x={labelW}
                  y={band.y}
                  width={plotW}
                  height={band.h}
                  fill={i % 2 === 0 ? '#f8fafc' : '#f1f5f9'}
                />
                {labelW > 0 ? (
                  <text
                    x={labelW - 8}
                    y={band.y + band.h / 2}
                    textAnchor="end"
                    dominantBaseline="central"
                    fontSize={10}
                    fill={synthetic ? '#94a3b8' : '#64748b'}
                    fontStyle={synthetic ? 'italic' : undefined}
                  >
                    {row.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Idle-gap seams */}
          {segments
            .filter((seg) => seg.kind === 'cut')
            .map((seg) => (
              <rect
                key={`cut-${seg.t0}`}
                x={px(seg.x0)}
                y={0}
                width={Math.max(px(seg.x1) - px(seg.x0), 2)}
                height={plotH}
                fill="url(#editmap-seam)"
              >
                <title>{formatDuration(seg.t1 - seg.t0)} idle — collapsed</title>
              </rect>
            ))}

          {/* Episode marks */}
          {marks.map((mark) => {
            const band = rowY.get(mark.rowKey)!;
            const laneH = band.h / mark.lanes;
            const color = colorForContributor(mark.episode.contributorId);
            const thin = mark.rowKey === UNPLACED_ROW_KEY;
            const h = thin ? Math.min(6, laneH - 1) : Math.max(laneH - 2, 4);
            const yMid = band.y + mark.lane * laneH + laneH / 2;
            return (
              <rect
                key={`${mark.episode.id}:${mark.rowKey}`}
                x={mark.x}
                y={yMid - h / 2}
                width={mark.w}
                height={h}
                rx={2}
                fill={color}
                fillOpacity={0.8}
                onMouseEnter={onHoverEpisode ? () => onHoverEpisode(mark.episode) : undefined}
                onMouseLeave={onHoverEpisode ? () => onHoverEpisode(null) : undefined}
              >
                <title>
                  {`${nameOf(mark.episode.contributorId)} · ${formatClock(mark.episode.startedAt)}–${formatClock(mark.episode.endedAt)} · ${mark.episode.burstCount} burst${mark.episode.burstCount === 1 ? '' : 's'}`}
                </title>
              </rect>
            );
          })}

          {/* Session start ticks */}
          {segments
            .filter((seg) => seg.kind === 'session')
            .map((seg) => {
              const x0 = px(seg.x0);
              const wide = px(seg.x1) - x0 >= 40;
              return (
                <g key={`session-${seg.t0}`}>
                  <line x1={x0} y1={0} x2={x0} y2={plotH} stroke="#e2e8f0" />
                  {wide ? (
                    <text x={x0 + 3} y={plotH + AXIS_H - 4} fontSize={10} fill="#64748b">
                      {formatClock(seg.t0)}
                    </text>
                  ) : null}
                </g>
              );
            })}
        </svg>
      ) : null}
    </div>
  );
});
