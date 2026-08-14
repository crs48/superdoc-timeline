import { useState } from 'react';
import { useIdentity } from '@/store/identity';
import type { RoomStatus } from '@/types';

const STATUS_LABEL: Record<RoomStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Live',
  error: 'Disconnected',
};

const STATUS_COLOR: Record<RoomStatus, string> = {
  idle: 'bg-slate-400',
  connecting: 'bg-amber-400',
  connected: 'bg-green-500',
  error: 'bg-red-500',
};

export function ShareBar({ status }: { status: RoomStatus }) {
  const name = useIdentity((s) => s.name);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the URL is in the address bar regardless.
      setCopied(false);
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-slate-900">SuperDoc Timeline</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-600">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_COLOR[status]}`} />
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <a
          href={`${import.meta.env.BASE_URL}prototypes/0008/index.html`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
        >
          UI prototypes
        </a>
        <span className="text-xs text-slate-600">
          You are <span className="font-medium text-slate-900">{name}</span>
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
      </div>
    </header>
  );
}
