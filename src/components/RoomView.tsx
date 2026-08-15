import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EditMapPanel } from './EditMapPanel';
import { EditorPane } from './EditorPane';
import { EditsPanel } from './EditsPanel';
import { HistoryBanner } from './HistoryBanner';
import { HistoryPreview } from './HistoryPreview';
import { ShareBar } from './ShareBar';
import { TimelineDock } from './TimelineDock';
import { useActivityPolling } from '@/contributions/useActivityPolling';
import { assignColors } from '@/lib/color';
import { usePlacementBackfill } from '@/spotlight/placementIndex';
import { useDock } from '@/store/dock';
import { useRoom } from '@/store/room';

type DockTab = 'map' | 'volume';

/**
 * Fixed chrome shell: header rows pinned on top, the timeline docked at the
 * bottom, and the document as the single scrolling region between them.
 * `h-dvh` + `overflow-hidden` on the shell and `min-h-0` on the scroll pane
 * are what keep the chrome from ever scrolling away.
 */
export function RoomView() {
  const { roomId } = useParams<{ roomId: string }>();
  const status = useRoom((s) => s.status);
  const lastError = useRoom((s) => s.lastError);
  const historyAt = useRoom((s) => s.historyAt);
  const setHistoryAt = useRoom((s) => s.setHistoryAt);
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [tab, setTab] = useState<DockTab>('map');
  const threadsPref = useDock((s) => s.threads);
  const toggleThreads = useDock((s) => s.toggleThreads);
  // Legend filter for the thread lens: same idiom as the Volume tab's solo.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const toggleContributor = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { series, onLocalEdit } = useActivityPolling(roomId ?? null, connectedOnce);
  usePlacementBackfill(roomId ?? null, connectedOnce);
  const onConnected = useCallback(() => setConnectedOnce(true), []);
  const onBucketClick = useCallback((t: number) => setHistoryAt(t), [setHistoryAt]);
  const onReturnToLive = useCallback(() => setHistoryAt(null), [setHistoryAt]);

  // The lens re-colours contributors collision-free (0012 finding 4); the
  // legend must agree with it or the chips lie.
  const lensColors = useMemo(
    () => assignColors(series.contributors.map((c) => c.id)),
    [series.contributors],
  );

  if (!roomId) return null;

  // A single author reduces to one line over a dimmed terrain — the terrain
  // is strictly better there, so the lens is only offered for ≥ 2 (0012 R6).
  const threadsAvailable = series.contributors.length >= 2;
  const threadsOn = threadsPref && threadsAvailable;

  const tabButton = (value: DockTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      aria-pressed={tab === value}
      className={`rounded px-2 py-0.5 text-xs ${
        tab === value
          ? 'bg-slate-800 font-medium text-white'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-100">
      <ShareBar status={status} />

      {historyAt != null ? <HistoryBanner at={historyAt} onReturnToLive={onReturnToLive} /> : null}

      {status === 'error' && lastError ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {lastError}
        </div>
      ) : null}

      {/* History Mode overlays the editor; the live instance and its socket
          stay mounted underneath (a remount can re-trip the create/join retry). */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <EditorPane roomId={roomId} onEdit={onLocalEdit} onConnected={onConnected} />
        {historyAt != null ? <HistoryPreview roomId={roomId} at={historyAt} /> : null}
      </div>

      <TimelineDock
        controls={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded border border-slate-200 p-0.5">
              {tabButton('map', 'Map')}
              {tabButton('volume', 'Volume')}
            </div>
            {tab === 'map' && threadsAvailable ? (
              <button
                type="button"
                onClick={toggleThreads}
                aria-pressed={threadsOn}
                title="Author threads: one storyline per contributor over the map"
                className={`rounded border px-2 py-0.5 text-xs ${
                  threadsOn
                    ? 'border-slate-800 bg-slate-800 font-medium text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Threads
              </button>
            ) : null}
            {tab === 'map' ? (
              <ul className="flex flex-wrap items-center gap-1">
                {series.contributors.map((contributor) => {
                  const hidden = threadsOn && hiddenIds.has(contributor.id);
                  const dot = threadsOn
                    ? (lensColors.get(contributor.id) ?? contributor.color)
                    : contributor.color;
                  return (
                    <li key={contributor.id}>
                      {threadsOn ? (
                        <button
                          type="button"
                          onClick={() => toggleContributor(contributor.id)}
                          aria-pressed={!hidden}
                          title={hidden ? `Show ${contributor.name}` : `Hide ${contributor.name}`}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-opacity hover:bg-slate-100 ${
                            hidden ? 'opacity-40' : 'text-slate-600'
                          }`}
                        >
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: dot }}
                          />
                          <span className={hidden ? 'line-through' : ''}>{contributor.name}</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 px-1.5 text-xs text-slate-600">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: contributor.color }}
                          />
                          {contributor.name}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        }
      >
        {tab === 'map' ? (
          <EditMapPanel
            contributors={series.contributors}
            connected={status === 'connected'}
            onPickTime={connectedOnce ? onBucketClick : undefined}
            threads={threadsOn}
            hiddenContributors={hiddenIds}
          />
        ) : (
          <EditsPanel
            series={series}
            connected={status === 'connected'}
            onBucketClick={connectedOnce ? onBucketClick : undefined}
          />
        )}
      </TimelineDock>
    </div>
  );
}
