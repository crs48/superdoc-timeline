import { useMemo } from 'react';
import { EditMap, REMOVED_ROW_KEY, UNPLACED_ROW_KEY, type MapRow } from './EditMap';
import { buildLineage, buildRowResolver, foldEpisodes } from '@/contributions/episodes';
import { buildSegments } from '@/contributions/sessions';
import { useActivity } from '@/store/activity';
import type { Contributor } from '@/types';

interface EditMapPanelProps {
  contributors: Contributor[];
  connected: boolean;
  /** History Mode: click the map to jump to that real timestamp. */
  onPickTime?: (t: number) => void;
}

/** Row height follows text length inside these bounds, so the y-axis reads
 *  like a minimap without one giant paragraph swallowing the chart. */
const ROW_WEIGHT_MIN = 40;
const ROW_WEIGHT_MAX = 400;
/** First words of the block text, as the row's label. */
function labelFor(text: string, index: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return `¶ ${index + 1}`;
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed;
}

/**
 * Data assembly for the space-time edit map: fold bursts into episodes using
 * the placement index, sessionize their time span, and lay one row per
 * canonical block of the latest reconstruction. Renders progressively — the
 * map fills in as the backfill locates bursts.
 */
export function EditMapPanel({ contributors, connected, onPickTime }: EditMapPanelProps) {
  const events = useActivity((s) => s.events);
  const placements = useActivity((s) => s.placements);
  const latestBlocks = useActivity((s) => s.latestBlocks);
  const error = useActivity((s) => s.error);

  const { episodes, segments, rows } = useMemo(() => {
    const blocks = latestBlocks ?? [];
    // Two lineage views on purpose: ancestry roots keep an episode together
    // across a paragraph split, while rows stay one-per-live-block so an
    // organically grown document doesn't collapse onto its seed paragraph.
    const folded = foldEpisodes(
      [...events.values()],
      (id) => placements.get(id),
      buildLineage(blocks),
    );
    const rowOf = buildRowResolver(blocks);
    const episodes = folded.map((episode) => ({
      ...episode,
      blockIds: new Set([...episode.blockIds].map((id) => rowOf(id) ?? REMOVED_ROW_KEY)),
    }));
    const segments = buildSegments(episodes);

    const rows: MapRow[] = blocks.map((block, i) => ({
      key: block.blockId,
      label: labelFor(block.text, i),
      weight: Math.min(Math.max(block.text.length, ROW_WEIGHT_MIN), ROW_WEIGHT_MAX),
    }));
    if (episodes.some((e) => e.blockIds.has(REMOVED_ROW_KEY))) {
      rows.push({ key: REMOVED_ROW_KEY, label: '(removed)', weight: ROW_WEIGHT_MIN });
    }
    if (episodes.some((e) => e.blockIds.size === 0)) {
      rows.push({ key: UNPLACED_ROW_KEY, label: 'elsewhere', weight: ROW_WEIGHT_MIN });
    }
    return { episodes, segments, rows };
  }, [events, placements, latestBlocks]);

  const nameOf = useMemo(() => {
    const names = new Map(contributors.map((c) => [c.id, c.name]));
    return (id: string) => names.get(id) ?? id.slice(0, 8);
  }, [contributors]);

  const located = placements.size;
  const total = events.size;

  if (error) {
    return (
      <p className="px-4 py-8 text-center text-xs text-amber-700">
        Activity is unavailable ({error}). The document keeps working.
      </p>
    );
  }
  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-slate-500">
        {connected
          ? 'No edits recorded yet. Type in the document to see where activity lands.'
          : 'Waiting for the collaboration server…'}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-slate-500">
        Locating edits… ({located}/{total})
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col px-2 pb-2">
      <div className="min-h-0 flex-1">
        <EditMap
          episodes={episodes}
          segments={segments}
          rows={rows}
          nameOf={nameOf}
          onPickTime={onPickTime}
        />
      </div>
      <p className="px-2 pt-1 text-[11px] text-slate-400">
        Rows are paragraphs; hatched seams are idle gaps over 5 min, collapsed.
        {located < total ? ` Locating edits… (${located}/${total})` : ''}
        {onPickTime ? ' Click to view the document at that moment.' : ''}
      </p>
    </div>
  );
}
