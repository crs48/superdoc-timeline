import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AXIS_H,
  EditMap,
  LABEL_W,
  REMOVED_ROW_KEY,
  UNPLACED_ROW_KEY,
  type BurstMark,
  type EpisodeHit,
  type MapRow,
} from './EditMap';
import { buildLineage, buildRowResolver, foldEpisodes } from '@/contributions/episodes';
import { buildSectionIndex, partitionSections } from '@/contributions/sections';
import { layoutSessions, sessionColumns, xOf } from '@/contributions/sessions';
import { buildThreads, type ThreadBurst, type ThreadGeometry } from '@/contributions/threads';
import { assignColors, colorForContributor } from '@/lib/color';
import { useActivity } from '@/store/activity';
import type { BlockText } from '@/spotlight/burstDiff';
import type { BurstPlacement } from '@/spotlight/placementIndex';
import type { Contributor, ContributionEvent } from '@/types';

interface EditMapPanelProps {
  contributors: Contributor[];
  connected: boolean;
  /** History Mode: click the map to jump to that real timestamp. */
  onPickTime?: (t: number) => void;
  /** Author-threads lens on (exploration 0012). */
  threads?: boolean;
  /** Contributors the legend has filtered out of the thread lens. */
  hiddenContributors?: ReadonlySet<string>;
}

/** Rows are measured, not configured: as many 36px rows as the plot fits. */
const TARGET_ROW_H = 36;
const MIN_ROWS = 3;

interface MapData {
  rows: MapRow[];
  segments: ReturnType<typeof layoutSessions>['segments'];
  contentW: number;
  marks: BurstMark[];
  hits: EpisodeHit[];
  /** Thread input: located bursts with weight distributed over rows. */
  threadBursts: ThreadBurst[];
}

/**
 * Project the activity store onto map geometry: fold bursts into episodes,
 * partition the document into ≤ maxRows contiguous sections (0005 R1), lay
 * sessions out in pixels (R2), and emit per-burst marks for the terrain plus
 * per-episode hits for the interaction layer (R3).
 */
function buildMapData(
  events: Map<string, ContributionEvent>,
  placements: Map<string, BurstPlacement>,
  blocks: BlockText[],
  maxRows: number,
  containerW: number,
): MapData {
  const bursts = [...events.values()];
  const rowOf = buildRowResolver(blocks);
  const episodes = foldEpisodes(bursts, (id) => placements.get(id), buildLineage(blocks));

  // Synthetic rows count against the cap, so the fit promise stays honest.
  const removedNeeded = episodes.some((e) => [...e.blockIds].some((id) => rowOf(id) === null));
  const unplacedNeeded = episodes.some((e) => e.blockIds.size === 0);
  const sectionCap = Math.max(1, maxRows - (removedNeeded ? 1 : 0) - (unplacedNeeded ? 1 : 0));
  const sections = partitionSections(blocks, sectionCap);
  const sectionIdx = buildSectionIndex(sections);

  const rowKeyForBlock = (blockId: string): string => {
    const live = rowOf(blockId);
    if (live === null) return REMOVED_ROW_KEY;
    const index = sectionIdx.get(live);
    return index == null ? REMOVED_ROW_KEY : `s${index}`;
  };

  const rows: MapRow[] = sections.map((section) => ({
    key: `s${section.index}`,
    label: section.label,
    weight: section.mass,
  }));
  const syntheticWeight =
    sections.length > 0
      ? (rows.reduce((sum, row) => sum + row.weight, 0) / sections.length) * 0.5
      : 40;
  if (removedNeeded) rows.push({ key: REMOVED_ROW_KEY, label: '(removed)', weight: syntheticWeight });
  if (unplacedNeeded) rows.push({ key: UNPLACED_ROW_KEY, label: 'elsewhere', weight: syntheticWeight });

  const { contentW, segments } = layoutSessions(episodes, bursts, containerW);

  const episodeRowKeys = new Map<string, string[]>();
  for (const episode of episodes) {
    const keys =
      episode.blockIds.size === 0
        ? [UNPLACED_ROW_KEY]
        : [...new Set([...episode.blockIds].map(rowKeyForBlock))];
    episodeRowKeys.set(episode.id, keys);
  }

  const hits: EpisodeHit[] = episodes.flatMap((episode) =>
    (episodeRowKeys.get(episode.id) ?? []).map((rowKey) => ({
      id: episode.id,
      rowKey,
      contributorId: episode.contributorId,
      x0: xOf(episode.startedAt, segments),
      x1: xOf(episode.endedAt, segments),
      startedAt: episode.startedAt,
      endedAt: episode.endedAt,
      burstCount: episode.burstCount,
    })),
  );

  // Terrain input: each burst paints on its OWN placed rows when located,
  // falling back to its episode's rows (so unplaced members of a placed
  // episode thicken that episode's lobe instead of leaking to the gutter).
  const marks: BurstMark[] = [];
  for (const episode of episodes) {
    const fallback = episodeRowKeys.get(episode.id) ?? [];
    for (const burstId of episode.burstIds) {
      const burst = events.get(burstId);
      if (!burst) continue;
      const own = placements
        .get(burstId)
        ?.changes.map((change) => rowKeyForBlock(change.blockId));
      const rowKeys = own && own.length > 0 ? [...new Set(own)] : fallback;
      const x0 = xOf(burst.startedAt, segments);
      const x1 = Math.max(xOf(burst.endedAt, segments), x0);
      for (const rowKey of rowKeys) {
        marks.push({ rowKey, contributorId: episode.contributorId, x0, x1, weight: burst.weight });
      }
    }
  }

  // Thread input (0012 finding 3): unlike `marks`, which paints the full
  // weight on every touched row (fine for a blurred terrain), a thread must
  // see each burst once. Placement changes give the exact per-row shape —
  // Σ(inserted + deleted) per block — which we normalise to shares of the
  // event's weight so thread volumes reconcile with the Volume tab (R8).
  // Only located bursts contribute: an unlocated burst is unknown, not
  // "elsewhere", and it would only add haze while the backfill runs.
  const threadBursts: ThreadBurst[] = [];
  for (const burst of bursts) {
    const placement = placements.get(burst.id);
    if (!placement) continue;
    const perRow = new Map<string, number>();
    let total = 0;
    for (const change of placement.changes) {
      const size = change.inserted.length + change.deleted.length;
      if (size <= 0) continue;
      const rowKey = rowKeyForBlock(change.blockId);
      perRow.set(rowKey, (perRow.get(rowKey) ?? 0) + size);
      total += size;
    }
    threadBursts.push({
      contributorId: burst.contributorId,
      startedAt: burst.startedAt,
      weight: burst.weight,
      rows:
        total > 0
          ? [...perRow].map(([rowKey, size]) => ({ rowKey, share: size / total }))
          : [],
    });
  }

  return { rows, segments, contentW, marks, hits, threadBursts };
}

/**
 * Data assembly + measurement for the organic edit terrain. The plot size is
 * measured here (one ResizeObserver) because the row cap derives from height
 * and the session layout from width — geometry flows down into EditMap.
 */
export function EditMapPanel({
  contributors,
  connected,
  onPickTime,
  threads = false,
  hiddenContributors,
}: EditMapPanelProps) {
  const events = useActivity((s) => s.events);
  const placements = useActivity((s) => s.placements);
  const latestBlocks = useActivity((s) => s.latestBlocks);
  const error = useActivity((s) => s.error);

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

  const labelW = size.width < 480 ? 0 : LABEL_W;
  const maxRows = Math.max(MIN_ROWS, Math.floor((size.height - AXIS_H) / TARGET_ROW_H));
  const containerW = Math.max(size.width - labelW, 0);

  const data = useMemo(
    () => buildMapData(events, placements, latestBlocks ?? [], maxRows, containerW),
    [events, placements, latestBlocks, maxRows, containerW],
  );

  const nameOf = useMemo(() => {
    const names = new Map(contributors.map((c) => [c.id, c.name]));
    return (id: string) => names.get(id) ?? id.slice(0, 8);
  }, [contributors]);

  // Threads read hue as identity, so the lens uses the collision-free
  // assignment (0012 finding 4). The terrain keeps the hash palette until
  // the swap has been looked at on a real room.
  const colorOf = useMemo(() => {
    if (!threads) return colorForContributor;
    const assigned = assignColors(contributors.map((c) => c.id));
    return (id: string) => assigned.get(id) ?? colorForContributor(id);
  }, [threads, contributors]);

  const geometry = useMemo<ThreadGeometry | undefined>(() => {
    if (!threads) return undefined;
    return buildThreads(data.threadBursts, data.rows, sessionColumns(data.segments), {
      hidden: hiddenContributors,
    });
  }, [threads, data, hiddenContributors]);

  const located = placements.size;
  const total = events.size;

  return (
    <div className="flex h-full flex-col px-2 pb-2">
      <div ref={hostRef} className="min-h-0 flex-1">
        {error ? (
          <p className="px-4 py-8 text-center text-xs text-amber-700">
            Activity is unavailable ({error}). The document keeps working.
          </p>
        ) : total === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-500">
            {connected
              ? 'No edits recorded yet. Type in the document to see where activity lands.'
              : 'Waiting for the collaboration server…'}
          </p>
        ) : data.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-500">
            Locating edits… ({located}/{total})
          </p>
        ) : (
          <EditMap
            width={size.width}
            height={size.height}
            contentW={data.contentW}
            segments={data.segments}
            rows={data.rows}
            marks={data.marks}
            hits={data.hits}
            labelW={labelW}
            nameOf={nameOf}
            onPickTime={onPickTime}
            threads={geometry}
            paintOpacity={geometry ? 0.25 : 1}
            colorOf={colorOf}
          />
        )}
      </div>
      <p className="px-2 pt-1 text-[11px] text-slate-400">
        Rows are document sections; hatched seams are idle gaps over 5 min, collapsed.
        {geometry
          ? ' Threads: one line per author — pill = whole-document pass, dotted = away; hover to solo.'
          : ''}
        {geometry && geometry.omitted.length > 0
          ? ` ${geometry.omitted.length} quieter author${geometry.omitted.length === 1 ? '' : 's'} not drawn.`
          : ''}
        {located < total ? ` Locating edits… (${located}/${total})` : ''}
        {onPickTime ? ' Click to view the document at that moment.' : ''}
      </p>
    </div>
  );
}
