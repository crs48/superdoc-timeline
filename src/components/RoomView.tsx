import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EditMapPanel } from './EditMapPanel';
import { EditorPane } from './EditorPane';
import { EditsPanel } from './EditsPanel';
import { HistoryBanner } from './HistoryBanner';
import { HistoryPreview } from './HistoryPreview';
import { ShareBar } from './ShareBar';
import { TimelineDock } from './TimelineDock';
import { useActivityPolling } from '@/contributions/useActivityPolling';
import { usePlacementBackfill } from '@/spotlight/placementIndex';
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

  const { series, onLocalEdit } = useActivityPolling(roomId ?? null, connectedOnce);
  usePlacementBackfill(roomId ?? null, connectedOnce);
  const onConnected = useCallback(() => setConnectedOnce(true), []);
  const onBucketClick = useCallback((t: number) => setHistoryAt(t), [setHistoryAt]);
  const onReturnToLive = useCallback(() => setHistoryAt(null), [setHistoryAt]);

  if (!roomId) return null;

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
            {tab === 'map' ? (
              <ul className="flex flex-wrap items-center gap-2">
                {series.contributors.map((contributor) => (
                  <li key={contributor.id} className="flex items-center gap-1 text-xs text-slate-600">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: contributor.color }}
                    />
                    {contributor.name}
                  </li>
                ))}
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
