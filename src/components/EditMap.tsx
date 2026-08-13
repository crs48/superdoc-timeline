import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROW_OVERFLOW,
  SAMPLE_STEP,
  chartCeiling,
  sampleIntensity,
  terrainPath,
} from './terrain';
import { tOf, type TimeSegment } from '@/contributions/sessions';
import { colorForContributor } from '@/lib/color';
import { formatClock, formatDuration } from '@/lib/time';

/** One y-axis band: a document section or a synthetic row. */
export interface MapRow {
  key: string;
  label: string;
  weight: number;
}

/** Synthetic row keys — the map draws these below the real sections. */
export const REMOVED_ROW_KEY = '__removed__';
export const UNPLACED_ROW_KEY = '__unplaced__';

/** Bottom strip reserved for time labels. Shared with the panel's maxRows math. */
export const AXIS_H = 16;
/** Width of the (non-scrolling) section label gutter. */
export const LABEL_W = 96;

/** One burst on one row — the terrain's kernel input. */
export interface BurstMark {
  rowKey: string;
  contributorId: string;
  x0: number;
  x1: number;
  weight: number;
}

/** One episode on one row — the transparent interaction layer. */
export interface EpisodeHit {
  id: string;
  rowKey: string;
  contributorId: string;
  x0: number;
  x1: number;
  startedAt: number;
  endedAt: number;
  burstCount: number;
}

interface EditMapProps {
  /** Viewport size (measured by the panel). */
  width: number;
  height: number;
  /** Chart content width — ≥ viewport; the plot scrolls when larger. */
  contentW: number;
  segments: TimeSegment[];
  rows: MapRow[];
  marks: BurstMark[];
  hits: EpisodeHit[];
  labelW: number;
  nameOf: (contributorId: string) => string;
  onPickTime?: (t: number) => void;
  /** Reserved for the 0003 hover spotlight; no-op until it lands. */
  onHoverEpisode?: (hit: EpisodeHit | null) => void;
}

const MIN_ROW_H = 12;
const MIN_HIT_W = 6;
const MORPH_MS = 300;

/**
 * Morph support (0005 R3): terrain series are fixed-cadence arrays, so a data
 * update can lerp old → new per index over ~300ms. Series whose length
 * changed (resize, content growth) snap instead.
 */
function useMorphedSeries(target: Map<string, Float32Array>): Map<string, Float32Array> {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    let lerpable = false;
    for (const [key, next] of target) {
      const prev = from.get(key);
      if (prev && prev.length === next.length && !sameSeries(prev, next)) lerpable = true;
    }
    if (!lerpable) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / MORPH_MS);
      const eased = 1 - (1 - t) * (1 - t);
      const next = new Map<string, Float32Array>();
      for (const [key, end] of target) {
        const start = from.get(key);
        if (!start || start.length !== end.length) {
          next.set(key, end);
          continue;
        }
        const mixed = new Float32Array(end.length);
        for (let i = 0; i < end.length; i += 1) {
          mixed[i] = start[i]! + (end[i]! - start[i]!) * eased;
        }
        next.set(key, mixed);
      }
      displayRef.current = t >= 1 ? target : next;
      setDisplay(displayRef.current);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return display;
}

function sameSeries(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The organic edit terrain (exploration 0005): section rows on y, an elastic
 * gap-compressed axis on x, and per-contributor kernel-density lobes as the
 * paint — smoothed, translucent, multiply-blended so overlapping authors mix.
 * Episode rectangles survive as a transparent hit layer above the terrain.
 */
export const EditMap = memo(function EditMap({
  width,
  height,
  contentW,
  segments,
  rows,
  marks,
  hits,
  labelW,
  nameOf,
  onPickTime,
  onHoverEpisode,
}: EditMapProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [hovered, setHovered] = useState<EpisodeHit | null>(null);

  const plotH = Math.max(height - AXIS_H, 0);
  const viewportW = Math.max(width - labelW, 0);
  const ready = viewportW > 40 && plotH > 30 && rows.length > 0 && segments.length > 0;

  // Row layout: proportional to weight with a floor, renormalized to fit.
  const bands = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
    const clamped = rows.map((row) => ({
      row,
      h: Math.max((row.weight / total) * plotH, MIN_ROW_H),
    }));
    const clampedTotal = clamped.reduce((sum, band) => sum + band.h, 0) || 1;
    const out = new Map<string, { row: MapRow; y: number; h: number }>();
    let y = 0;
    for (const band of clamped) {
      const h = (band.h / clampedTotal) * plotH;
      out.set(band.row.key, { row: band.row, y, h });
      y += h;
    }
    return out;
  }, [rows, plotH]);

  // Terrain: one intensity series per (row × contributor).
  const terrain = useMemo(() => {
    const inCut = (x: number) =>
      segments.some((s) => s.kind === 'cut' && x >= s.x0 && x <= s.x1);
    const byPair = new Map<string, BurstMark[]>();
    for (const mark of marks) {
      const key = `${mark.rowKey}|${mark.contributorId}`;
      let list = byPair.get(key);
      if (!list) byPair.set(key, (list = []));
      list.push(mark);
    }
    const series = new Map<string, Float32Array>();
    for (const [key, list] of byPair) {
      series.set(key, sampleIntensity(list, contentW, inCut));
    }
    return series;
  }, [marks, segments, contentW]);

  const displayed = useMorphedSeries(terrain);

  const ceiling = useMemo(() => {
    const maxima: number[] = [];
    for (const samples of displayed.values()) {
      let max = 0;
      for (let i = 0; i < samples.length; i += 1) if (samples[i]! > max) max = samples[i]!;
      maxima.push(max);
    }
    return chartCeiling(maxima);
  }, [displayed]);

  // Live-edge pinning. The scroll listener is attached natively (not via
  // React's onScroll): programmatic and user scrolls both must release the
  // pin, and a passive DOM listener is the reliable way to see every one.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      pinnedRef.current = el.scrollLeft >= el.scrollWidth - el.clientWidth - 24;
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  // Stay pinned to the right while the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollLeft = el.scrollWidth;
  }, [contentW]);

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!onPickTime || !ready) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < 0 || x > contentW) return;
    onPickTime(tOf(x, segments));
  }

  // The hovered contributor's chip sits at their tallest lobe inside the hit.
  const chip = useMemo(() => {
    if (!hovered) return null;
    const band = bands.get(hovered.rowKey);
    const samples = displayed.get(`${hovered.rowKey}|${hovered.contributorId}`);
    if (!band || !samples) return null;
    const from = Math.max(0, Math.floor(hovered.x0 / SAMPLE_STEP));
    const to = Math.min(samples.length - 1, Math.ceil(hovered.x1 / SAMPLE_STEP));
    let peakI = from;
    for (let i = from; i <= to; i += 1) if (samples[i]! > samples[peakI]!) peakI = i;
    const rise = Math.min((samples[peakI]! / ceiling) * band.h, band.h * ROW_OVERFLOW);
    return {
      x: peakI * SAMPLE_STEP,
      y: Math.max(10, band.y + band.h - rise - 6),
      name: nameOf(hovered.contributorId),
      color: colorForContributor(hovered.contributorId),
    };
  }, [hovered, bands, displayed, ceiling, nameOf]);

  if (!ready) return <div className="h-full w-full" />;

  return (
    <div className="flex h-full w-full">
      {labelW > 0 ? (
        <div className="relative shrink-0" style={{ width: labelW }}>
          {[...bands.values()].map(({ row, y, h }) => {
            const synthetic = row.key === REMOVED_ROW_KEY || row.key === UNPLACED_ROW_KEY;
            const [snippet, range] = row.label.split(' · ');
            return (
              <div
                key={row.key}
                title={row.label}
                className={`absolute right-2 left-1 flex flex-col justify-center text-[10px] leading-tight ${
                  synthetic ? 'italic text-slate-400' : 'text-slate-500'
                }`}
                style={{ top: y, height: h }}
              >
                <span className="truncate">{snippet}</span>
                {range && h >= 26 ? <span className="text-slate-400">{range}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
        <svg
          width={contentW}
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

          {/* Faint row baselines (separators demoted per 0005 R3). */}
          {[...bands.values()].map(({ row, y, h }) => (
            <line
              key={`base-${row.key}`}
              x1={0}
              y1={y + h}
              x2={contentW}
              y2={y + h}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}

          {/* Terrain lobes, multiply-blended so overlapping authors mix. */}
          {[...displayed.entries()].map(([key, samples]) => {
            const sep = key.lastIndexOf('|');
            const rowKey = key.slice(0, sep);
            const contributorId = key.slice(sep + 1);
            const band = bands.get(rowKey);
            if (!band) return null;
            const d = terrainPath(
              samples,
              band.y + band.h,
              band.h / ceiling,
              band.h * ROW_OVERFLOW,
            );
            return (
              <path
                key={key}
                d={d}
                fill={colorForContributor(contributorId)}
                fillOpacity={0.65}
                style={{ mixBlendMode: 'multiply' }}
              />
            );
          })}

          {/* Idle-gap seams, over the terrain (which is zero inside them). */}
          {segments
            .filter((seg) => seg.kind === 'cut')
            .map((seg) => (
              <rect
                key={`cut-${seg.t0}`}
                x={seg.x0}
                y={0}
                width={Math.max(seg.x1 - seg.x0, 2)}
                height={plotH}
                fill="url(#editmap-seam)"
              >
                <title>{formatDuration(seg.t1 - seg.t0)} idle — collapsed</title>
              </rect>
            ))}

          {/* Session ticks + intermediate time ticks (~every 120px). */}
          {segments
            .filter((seg) => seg.kind === 'session')
            .map((seg) => {
              const w = seg.x1 - seg.x0;
              const inner: number[] = [];
              // Inner ticks only when the session has real time structure —
              // a stretched near-instant session would repeat one minute.
              if (seg.t1 - seg.t0 >= 2 * 60_000) {
                for (let x = seg.x0 + 120; x < seg.x1 - 40; x += 120) inner.push(x);
              }
              return (
                <g key={`session-${seg.t0}`}>
                  <line x1={seg.x0} y1={0} x2={seg.x0} y2={plotH} stroke="#e2e8f0" />
                  {w >= 40 ? (
                    <text x={seg.x0 + 3} y={plotH + AXIS_H - 4} fontSize={10} fill="#64748b">
                      {formatClock(seg.t0)}
                    </text>
                  ) : null}
                  {inner.map((x) => (
                    <g key={x}>
                      <line x1={x} y1={plotH - 3} x2={x} y2={plotH} stroke="#cbd5e1" />
                      <text x={x + 2} y={plotH + AXIS_H - 4} fontSize={9} fill="#94a3b8">
                        {formatClock(tOf(x, segments))}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}

          {/* Transparent episode hit layer: tooltips, hover, future spotlight. */}
          {hits.map((hit) => {
            const band = bands.get(hit.rowKey);
            if (!band) return null;
            return (
              <rect
                key={`${hit.id}:${hit.rowKey}`}
                x={hit.x0}
                y={band.y}
                width={Math.max(hit.x1 - hit.x0, MIN_HIT_W)}
                height={band.h}
                fill="transparent"
                onMouseEnter={() => {
                  setHovered(hit);
                  onHoverEpisode?.(hit);
                }}
                onMouseLeave={() => {
                  setHovered((prev) => (prev?.id === hit.id && prev.rowKey === hit.rowKey ? null : prev));
                  onHoverEpisode?.(null);
                }}
              >
                <title>
                  {`${nameOf(hit.contributorId)} · ${formatClock(hit.startedAt)}–${formatClock(hit.endedAt)} · ${hit.burstCount} burst${hit.burstCount === 1 ? '' : 's'}`}
                </title>
              </rect>
            );
          })}

          {/* Contributor chip at the hovered episode's tallest lobe. */}
          {chip ? (
            <g pointerEvents="none">
              <rect
                x={chip.x - chip.name.length * 3.2 - 5}
                y={chip.y - 14}
                width={chip.name.length * 6.4 + 10}
                height={14}
                rx={7}
                fill={chip.color}
              />
              <text
                x={chip.x}
                y={chip.y - 3.5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill="#fff"
              >
                {chip.name}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
});
