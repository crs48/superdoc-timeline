import { columnOf, type TimeSegment } from './sessions';
import type { ContributorId } from '@/types';

/**
 * Author threads (explorations 0011/0012): one storyline per contributor,
 * weaving between the document sections they edited, session by session.
 * The layout is deliberately pixel-free — x is a timestamp, y is a
 * (row, lane) pair — so the whole algorithm is testable without a DOM and
 * the renderer is two lookups. Fixing y to document rows is what makes the
 * storyline literature's NP-hard layout unnecessary: the only free variable
 * left is sub-lane order inside a (session × row) bundle, and a single
 * barycenter pass handles it.
 */

/** Row key of the synthetic "location unknown" row (mirrors EditMap). */
export const THREAD_UNPLACED_ROW_KEY = '__unplaced__';

/** Thread input: one burst, with its weight distributed over the rows it touched. */
export interface ThreadBurst {
  contributorId: ContributorId;
  startedAt: number;
  /** Chart weight of the burst (the Volume tab's unit); shares must sum to ~1. */
  weight: number;
  /** Fraction of `weight` that landed on each row. Empty = unplaced. */
  rows: Array<{ rowKey: string; share: number }>;
}

/** Row descriptor — only the ordered keys matter here. */
export interface ThreadRow {
  key: string;
}

export type ThreadNode =
  | {
      kind: 'focus';
      /** Index into the session columns the axis drew. */
      session: number;
      /** Timestamp for x — the column's midpoint. */
      t: number;
      rowKey: string;
      /** Sub-lane inside the row's bundle for this session, 0-based. */
      lane: number;
      laneCount: number;
      weight: number;
    }
  | {
      kind: 'sweep';
      session: number;
      t: number;
      /** First and last row (in document order) the sweep spans. */
      rowKey0: string;
      rowKey1: string;
      weight: number;
    };

export interface ThreadLink {
  /** Indices into `nodes`. */
  from: number;
  to: number;
  /** True when at least one session column was skipped between the ends. */
  dormant: boolean;
}

export interface Thread {
  contributorId: ContributorId;
  nodes: ThreadNode[];
  links: ThreadLink[];
  /** Σ node weight — the top-N cut and legend order. */
  weight: number;
}

export interface ThreadGeometry {
  threads: Thread[];
  /** Denominator for the √-scaled ribbon width. ≥ 1. */
  maxNodeWeight: number;
  /** Contributors dropped by the top-N cut, most active first. */
  omitted: ContributorId[];
}

export interface BuildThreadsOptions {
  /** Keep the N heaviest contributors; the rest are reported in `omitted`. */
  topN?: number;
  /** Contributors filtered out by the user — never rendered, never counted. */
  hidden?: ReadonlySet<ContributorId>;
}

/** Below this many rows there is no meaningful "whole document" to sweep. */
export const SWEEP_MIN_ROWS = 4;
/** Default top-N: matches 0006's ≤ 8-hues rule. */
export const DEFAULT_TOP_N = 8;

/**
 * How many rows a session's work must touch (or span) to be a sweep. Rows
 * are measured, not fixed (0012 finding 2), so the cut is relative: half the
 * rows, never below three.
 */
export function sweepThreshold(rowCount: number): number {
  return Math.max(3, Math.ceil(rowCount / 2));
}

/** One contributor's aggregated work in one column: row → weight. */
type Cell = Map<string, number>;

interface TypedFocus {
  kind: 'focus';
  rowIndex: number;
  weight: number;
}
interface TypedSweep {
  kind: 'sweep';
  row0: number;
  row1: number;
  weight: number;
}

/**
 * Type a (column × contributor) cell as a focus point or a whole-document
 * sweep. Unplaced weight counts toward volume but never toward *where*:
 * "we don't know" must not read as "everywhere" (a sweep is a claim).
 */
export function typeCell(
  cell: Cell,
  rowIndex: ReadonlyMap<string, number>,
  rowCount: number,
): TypedFocus | TypedSweep | null {
  let total = 0;
  const touched: Array<{ index: number; weight: number }> = [];
  for (const [key, weight] of cell) {
    total += weight;
    if (key === THREAD_UNPLACED_ROW_KEY) continue;
    const index = rowIndex.get(key);
    if (index == null) continue;
    touched.push({ index, weight });
  }
  if (touched.length === 0) return null;
  touched.sort((a, b) => a.index - b.index);

  const first = touched[0]!.index;
  const last = touched[touched.length - 1]!.index;
  const span = last - first + 1;
  const cut = sweepThreshold(rowCount);
  if (rowCount >= SWEEP_MIN_ROWS && (touched.length >= cut || span >= cut)) {
    return { kind: 'sweep', row0: first, row1: last, weight: total };
  }
  // Focus: the row that took the most weight, not the median row.
  let best = touched[0]!;
  for (const t of touched) if (t.weight > best.weight) best = t;
  return { kind: 'focus', rowIndex: best.index, weight: total };
}

/**
 * Lay out author threads over the session columns the axis drew.
 * Pixel-free by construction: nodes carry a timestamp and a (rowKey, lane).
 */
export function buildThreads(
  bursts: ThreadBurst[],
  rows: ThreadRow[],
  columns: TimeSegment[],
  opts: BuildThreadsOptions = {},
): ThreadGeometry {
  const rowIndex = new Map<string, number>();
  rows.forEach((row, i) => rowIndex.set(row.key, i));
  const rowCount = rows.length;
  const hidden = opts.hidden ?? new Set<ContributorId>();
  const topN = opts.topN ?? DEFAULT_TOP_N;

  // 1. Aggregate: column → contributor → row → weight.
  const grid: Array<Map<ContributorId, Cell>> = columns.map(() => new Map());
  const totalOf = new Map<ContributorId, number>();
  for (const burst of bursts) {
    if (hidden.has(burst.contributorId)) continue;
    const col = columnOf(burst.startedAt, columns);
    if (col < 0) continue;
    let byContributor = grid[col]!.get(burst.contributorId);
    if (!byContributor) grid[col]!.set(burst.contributorId, (byContributor = new Map()));
    if (burst.rows.length === 0) {
      bump(byContributor, THREAD_UNPLACED_ROW_KEY, burst.weight);
    } else {
      for (const { rowKey, share } of burst.rows) bump(byContributor, rowKey, burst.weight * share);
    }
    totalOf.set(burst.contributorId, (totalOf.get(burst.contributorId) ?? 0) + burst.weight);
  }

  // 2. Top-N by total weight; ties broken by id so every client agrees.
  const ranked = [...totalOf.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
  const kept = new Set(ranked.slice(0, topN));
  const omitted = ranked.slice(topN);

  // 3. Per column: type each cell, bundle focus nodes per row, assign lanes.
  const nodesOf = new Map<ContributorId, ThreadNode[]>();
  // Where each thread last was, as a row ordinal (fractional for sweeps) —
  // the barycenter the next bundle sorts against.
  const lastOrdinal = new Map<ContributorId, number>();
  const push = (id: ContributorId, node: ThreadNode, ordinal: number) => {
    let list = nodesOf.get(id);
    if (!list) nodesOf.set(id, (list = []));
    list.push(node);
    lastOrdinal.set(id, ordinal);
  };

  columns.forEach((column, session) => {
    const t = (column.t0 + column.t1) / 2;
    const bundles = new Map<number, Array<{ id: ContributorId; weight: number }>>();
    const sweeps: Array<{ id: ContributorId; typed: TypedSweep }> = [];
    // Iterate in a stable order so lane ties resolve identically everywhere.
    const ids = [...grid[session]!.keys()].filter((id) => kept.has(id)).sort();
    for (const id of ids) {
      const typed = typeCell(grid[session]!.get(id)!, rowIndex, rowCount);
      if (!typed) continue;
      if (typed.kind === 'sweep') {
        sweeps.push({ id, typed });
      } else {
        let list = bundles.get(typed.rowIndex);
        if (!list) bundles.set(typed.rowIndex, (list = []));
        list.push({ id, weight: typed.weight });
      }
    }
    for (const [rowIdx, list] of bundles) {
      // One barycenter pass: sort by where each thread came from, so threads
      // arriving from above sit above and crossings inside the bundle vanish.
      list.sort(
        (a, b) =>
          (lastOrdinal.get(a.id) ?? rowIdx) - (lastOrdinal.get(b.id) ?? rowIdx) ||
          (a.id < b.id ? -1 : 1),
      );
      list.forEach(({ id, weight }, lane) => {
        // Sub-lane ordinal: row index plus a small offset that preserves
        // lane order for the *next* barycenter sort.
        const ordinal = rowIdx + (lane - (list.length - 1) / 2) * 0.1;
        push(
          id,
          { kind: 'focus', session, t, rowKey: rows[rowIdx]!.key, lane, laneCount: list.length, weight },
          ordinal,
        );
      });
    }
    for (const { id, typed } of sweeps) {
      push(
        id,
        {
          kind: 'sweep',
          session,
          t,
          rowKey0: rows[typed.row0]!.key,
          rowKey1: rows[typed.row1]!.key,
          weight: typed.weight,
        },
        (typed.row0 + typed.row1) / 2,
      );
    }
  });

  // 4. Links: consecutive nodes; dormant when session columns were skipped.
  let maxNodeWeight = 1;
  const threads: Thread[] = [];
  for (const id of ranked) {
    const nodes = nodesOf.get(id);
    if (!nodes || nodes.length === 0) continue;
    const links: ThreadLink[] = [];
    let weight = 0;
    nodes.forEach((node, i) => {
      weight += node.weight;
      if (node.weight > maxNodeWeight) maxNodeWeight = node.weight;
      if (i > 0) {
        links.push({ from: i - 1, to: i, dormant: node.session - nodes[i - 1]!.session > 1 });
      }
    });
    threads.push({ contributorId: id, nodes, links, weight });
  }

  return { threads, maxNodeWeight, omitted };
}

function bump(cell: Cell, key: string, weight: number): void {
  cell.set(key, (cell.get(key) ?? 0) + weight);
}
