import { formatClock } from '@/lib/time';

interface HistoryBannerProps {
  /** Unix ms — the moment being viewed. */
  at: number;
  onReturnToLive: () => void;
}

/**
 * History Mode's banner, rendered in the page chrome rather than inside the
 * preview overlay: the mode indicator and its exit must stay visible no matter
 * how the document underneath scrolls.
 */
export function HistoryBanner({ at, onReturnToLive }: HistoryBannerProps) {
  return (
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
  );
}
