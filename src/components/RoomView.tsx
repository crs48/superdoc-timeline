import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EditorPane } from './EditorPane';
import { EditsPanel } from './EditsPanel';
import { HistoryPreview } from './HistoryPreview';
import { ShareBar } from './ShareBar';
import { useActivityPolling } from '@/contributions/useActivityPolling';
import { useRoom } from '@/store/room';

export function RoomView() {
  const { roomId } = useParams<{ roomId: string }>();
  const status = useRoom((s) => s.status);
  const lastError = useRoom((s) => s.lastError);
  const historyAt = useRoom((s) => s.historyAt);
  const setHistoryAt = useRoom((s) => s.setHistoryAt);
  const [connectedOnce, setConnectedOnce] = useState(false);

  const { series, onLocalEdit } = useActivityPolling(roomId ?? null, connectedOnce);
  const onConnected = useCallback(() => setConnectedOnce(true), []);
  const onBucketClick = useCallback((t: number) => setHistoryAt(t), [setHistoryAt]);
  const onReturnToLive = useCallback(() => setHistoryAt(null), [setHistoryAt]);

  if (!roomId) return null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <ShareBar status={status} />

      {status === 'error' && lastError ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {lastError}
        </div>
      ) : null}

      {/* History Mode overlays the editor; the live instance and its socket
          stay mounted underneath (a remount can re-trip the create/join retry). */}
      <div className="relative flex-1 overflow-auto">
        <EditorPane roomId={roomId} onEdit={onLocalEdit} onConnected={onConnected} />
        {historyAt != null ? (
          <HistoryPreview roomId={roomId} at={historyAt} onReturnToLive={onReturnToLive} />
        ) : null}
      </div>

      <EditsPanel
        series={series}
        connected={status === 'connected'}
        onBucketClick={connectedOnce ? onBucketClick : undefined}
      />
    </div>
  );
}
