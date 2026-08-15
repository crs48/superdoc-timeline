import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { xOf, type TimeSegment } from '@/contributions/sessions';
import type { Thread, ThreadGeometry, ThreadNode } from '@/contributions/threads';
import { formatClock } from '@/lib/time';

/** Row bands the map laid out: rowKey → vertical extent. */
export type BandLookup = ReadonlyMap<string, { y: number; h: number }>;

interface ThreadLayerProps {
  geometry: ThreadGeometry;
  bands: BandLookup;
  segments: TimeSegment[];
  colorOf: (contributorId: string) => string;
  nameOf: (contributorId: string) => string;
  /** Click a node → History Mode at that session's start. */
  onPickSession?: (t: number) => void;
  /** Left edge for entry labels; 0 when the label gutter is hidden. */
  labelInset: number;
}

/** Ribbon width from node weight — √-scaled so a paste doesn't own the axis. */
function widthOf(weight: number, max: number): number {
  return 1.6 + 6.5 * Math.sqrt(weight / max);
}

/** Sub-lane spacing scales with the band; thin bands collapse toward one lane. */
function laneGap(bandH: number): number {
  return Math.min(13, Math.max(6, bandH / 5));
}

const SOLO_DIM = 0.12;
const MORPH_MS = 300;

/**
 * Tapered connector: two vertically-offset bump curves (the d3 `curveBumpX`
 * shape) joined and filled. SVG has no variable-width stroke, so a ribbon
 * whose thickness encodes volume must be an area.
 */
export function ribbonPath(
  x0: number,
  y0: number,
  w0: number,
  x1: number,
  y1: number,
  w1: number,
): string {
  const mx = ((x0 + x1) / 2).toFixed(1);
  const a = w0 / 2;
  const b = w1 / 2;
  const f = (n: number) => n.toFixed(1);
  return (
    `M${f(x0)},${f(y0 - a)} C${mx},${f(y0 - a)} ${mx},${f(y1 - b)} ${f(x1)},${f(y1 - b)}` +
    `L${f(x1)},${f(y1 + b)} C${mx},${f(y1 + b)} ${mx},${f(y0 + a)} ${f(x0)},${f(y0 + a)} Z`
  );
}

/** Centre-line bump curve, for dormant dashes and the hit stroke. */
function bumpPath(x0: number, y0: number, x1: number, y1: number): string {
  const mx = ((x0 + x1) / 2).toFixed(1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

interface Placed {
  node: ThreadNode;
  x: number;
  y: number;
  /** Sweep extent; undefined for focus nodes. */
  y0?: number;
  y1?: number;
}

/** Resolve a node's (rowKey, lane) into pixels against the map's bands. */
function place(node: ThreadNode, bands: BandLookup, segments: TimeSegment[]): Placed | null {
  const x = xOf(node.t, segments);
  if (node.kind === 'focus') {
    const band = bands.get(node.rowKey);
    if (!band) return null;
    const gap = laneGap(band.h);
    const y = band.y + band.h / 2 + (node.lane - (node.laneCount - 1) / 2) * gap;
    return { node, x, y };
  }
  const b0 = bands.get(node.rowKey0);
  const b1 = bands.get(node.rowKey1);
  if (!b0 || !b1) return null;
  const y0 = b0.y + 3;
  const y1 = b1.y + b1.h - 3;
  return { node, x, y: (y0 + y1) / 2, y0, y1 };
}

/** Stable identity for morphing: the same person in the same session column. */
const keyOf = (id: string, node: ThreadNode) => `${id}|${node.session}`;

/**
 * Morph node y across row repartitions (0012 finding 6, the terrain's
 * `useMorphedSeries` idiom): rows are re-derived every poll and re-counted on
 * dock resize, and a thread that snaps between bands reads as a bug. Nodes
 * whose key persists lerp from their previous y over ~300ms; new nodes and
 * changed x snap.
 */
function useMorphedY(target: Map<string, Placed>): Map<string, Placed> {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    let lerpable = false;
    for (const [key, next] of target) {
      const prev = from.get(key);
      if (prev && Math.abs(prev.y - next.y) > 0.5) lerpable = true;
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
      const next = new Map<string, Placed>();
      for (const [key, end] of target) {
        const start = from.get(key);
        if (!start) {
          next.set(key, end);
          continue;
        }
        const mix = (a: number | undefined, b: number | undefined) =>
          a == null || b == null ? b : a + (b - a) * eased;
        next.set(key, {
          ...end,
          y: mix(start.y, end.y)!,
          y0: mix(start.y0, end.y0),
          y1: mix(start.y1, end.y1),
        });
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

/**
 * The author-threads lens (explorations 0011/0012): one storyline per
 * contributor over the dimmed terrain. Curtains for whole-document sweeps,
 * tapered ribbons between adjacent sessions, dotted "furlough" dashes across
 * absences, and hover-solo. Geometry arrives pixel-free; this layer only
 * resolves (t, rowKey, lane) against the map's own axis and bands.
 */
export const ThreadLayer = memo(function ThreadLayer({
  geometry,
  bands,
  segments,
  colorOf,
  nameOf,
  onPickSession,
  labelInset,
}: ThreadLayerProps) {
  const [soloed, setSoloed] = useState<string | null>(null);

  const placedTarget = useMemo(() => {
    const out = new Map<string, Placed>();
    for (const thread of geometry.threads) {
      for (const node of thread.nodes) {
        const p = place(node, bands, segments);
        if (p) out.set(keyOf(thread.contributorId, node), p);
      }
    }
    return out;
  }, [geometry, bands, segments]);
  const placed = useMorphedY(placedTarget);

  const sessionStart = (session: number) =>
    segments.filter((s) => s.kind === 'session')[session]?.t0;

  const renderThread = (thread: Thread) => {
    const id = thread.contributorId;
    const color = colorOf(id);
    const name = nameOf(id);
    const pts = thread.nodes
      .map((node) => placed.get(keyOf(id, node)))
      .filter((p): p is Placed => p != null);
    if (pts.length === 0) return null;
    const dim = soloed != null && soloed !== id;
    const width = (n: ThreadNode) => widthOf(n.weight, geometry.maxNodeWeight);
    const CURTAIN_W = 22;

    return (
      <g
        key={id}
        data-thread={id}
        style={{ opacity: dim ? SOLO_DIM : 1, transition: 'opacity 150ms' }}
        onMouseEnter={() => setSoloed(id)}
        onMouseLeave={() => setSoloed((prev) => (prev === id ? null : prev))}
      >
        {/* Curtains first, under everything. */}
        {pts.map((p) =>
          p.node.kind === 'sweep' && p.y0 != null && p.y1 != null ? (
            <rect
              key={`curtain-${p.node.session}`}
              x={p.x - CURTAIN_W / 2}
              y={p.y0}
              width={CURTAIN_W}
              height={Math.max(p.y1 - p.y0, 4)}
              rx={10}
              fill={color}
              fillOpacity={0.18}
              stroke={color}
              strokeOpacity={0.3}
            >
              <title>{`${name} — swept the document · ${formatClock(p.node.t)}`}</title>
            </rect>
          ) : null,
        )}

        {/* Links: tapered ribbon between adjacent sessions, furlough dash across gaps. */}
        {thread.links.map((link) => {
          const a = placed.get(keyOf(id, thread.nodes[link.from]!));
          const b = placed.get(keyOf(id, thread.nodes[link.to]!));
          if (!a || !b) return null;
          if (link.dormant) {
            return (
              <path
                key={`link-${link.from}`}
                d={bumpPath(a.x, a.y, b.x, b.y)}
                fill="none"
                stroke={color}
                strokeWidth={1.1}
                strokeOpacity={0.35}
                strokeDasharray="1 5"
                strokeLinecap="round"
              />
            );
          }
          return (
            <path
              key={`link-${link.from}`}
              d={ribbonPath(a.x, a.y, width(a.node), b.x, b.y, width(b.node))}
              fill={color}
              fillOpacity={0.75}
            />
          );
        })}

        {/* Focus nodes. */}
        {pts.map((p) =>
          p.node.kind === 'focus' ? (
            <circle
              key={`node-${p.node.session}`}
              cx={p.x}
              cy={p.y}
              r={width(p.node) / 2 + 1.6}
              fill={color}
              style={onPickSession ? { cursor: 'pointer' } : undefined}
              onClick={(e) => {
                const t = sessionStart(p.node.session);
                if (onPickSession && t != null) {
                  e.stopPropagation();
                  onPickSession(t);
                }
              }}
            >
              <title>{`${name} · ${formatClock(p.node.t)} · ~${Math.round(p.node.weight)} chars`}</title>
            </circle>
          ) : null,
        )}

        {/* Entry label; exit label when the thread runs long enough to lose its start. */}
        {(() => {
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          const entryX = Math.max(first.x - 8, labelInset + 2);
          const anchor = first.x - 8 < labelInset + 2 ? 'start' : 'end';
          return (
            <>
              <text
                x={entryX}
                y={first.y + 3.5}
                fontSize={9.5}
                fontWeight={600}
                textAnchor={anchor}
                fill={color}
                pointerEvents="none"
              >
                {name}
              </text>
              {last.node.session - first.node.session > 2 ? (
                <text
                  x={last.x + 9}
                  y={last.y + 3.5}
                  fontSize={9.5}
                  fontWeight={600}
                  fill={color}
                  pointerEvents="none"
                >
                  {name}
                </text>
              ) : null}
            </>
          );
        })()}

        {/* Painted-transparent fat stroke: the hover target for the whole thread. */}
        {thread.links.map((link) => {
          const a = placed.get(keyOf(id, thread.nodes[link.from]!));
          const b = placed.get(keyOf(id, thread.nodes[link.to]!));
          if (!a || !b) return null;
          return (
            <path
              key={`hit-${link.from}`}
              d={bumpPath(a.x, a.y, b.x, b.y)}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
            />
          );
        })}
      </g>
    );
  };

  // Draw lightest threads first so the heaviest sit on top.
  return <g data-layer="threads">{[...geometry.threads].reverse().map(renderThread)}</g>;
});
