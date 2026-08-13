import { useEffect, useState } from 'react';
import { extractParagraphs, fetchDocumentAt } from '@/history/fetchDocumentAt';
import { formatClock } from '@/lib/time';

interface HistoryPreviewProps {
  roomId: string;
  /** Unix ms — the moment being viewed. */
  at: number;
  onReturnToLive: () => void;
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; paragraphs: string[] };

/**
 * Read-only view of the document as it was at `at`, reconstructed by the
 * server. Rendered as an overlay ABOVE the live editor: the editor (and its
 * socket) stays mounted underneath, and read-only is enforced by never
 * rendering an editing surface here at all.
 */
export function HistoryPreview({ roomId, at, onReturnToLive }: HistoryPreviewProps) {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchDocumentAt(roomId, at, controller.signal)
      .then((doc) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', paragraphs: extractParagraphs(doc) });
        doc.destroy();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: error instanceof Error ? error.message : 'fetch failed' });
      });
    return () => controller.abort();
  }, [roomId, at]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-slate-50/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2">
        <p className="text-sm text-amber-900">
          <span className="font-semibold">History Mode</span> — document as of{' '}
          <span className="font-semibold">{formatClock(at)}</span> · read-only
        </p>
        <button
          type="button"
          onClick={onReturnToLive}
          className="rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          Return to live
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {state.kind === 'loading' ? (
          <p className="text-sm text-slate-500">Reconstructing the document…</p>
        ) : state.kind === 'error' ? (
          <p className="text-sm text-red-700">
            Could not load history ({state.message}). The live document is unaffected.
          </p>
        ) : state.paragraphs.length === 0 ? (
          <p className="text-sm text-slate-500">The document was empty at this point.</p>
        ) : (
          <div className="mx-auto max-w-2xl rounded border border-slate-200 bg-white px-10 py-8 shadow-sm">
            {state.paragraphs.map((text, i) => (
              <p key={i} className="mb-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                {text || ' '}
              </p>
            ))}
          </div>
        )}
      </div>

      <p className="border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-400">
        Text-level preview reconstructed from the server's history — formatting is intentionally not
        replayed. Click the chart to jump elsewhere, or return to live to keep editing.
      </p>
    </div>
  );
}
