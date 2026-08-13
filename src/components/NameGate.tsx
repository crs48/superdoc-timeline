import { useState, type FormEvent, type ReactNode } from 'react';
import { useIdentity } from '@/store/identity';

/**
 * Blocks every route until the user has told us who they are. Shown on the
 * landing page and on a shared room link alike, which is what makes "anyone
 * with the URL joins and enters their own name" work with one component.
 */
export function NameGate({ children }: { children: ReactNode }) {
  const name = useIdentity((s) => s.name);
  const setName = useIdentity((s) => s.setName);
  const [draft, setDraft] = useState('');

  if (name.trim().length > 0) return <>{children}</>;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim().length === 0) return;
    setName(draft);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">SuperDoc Timeline</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload a Word document, share the link, and watch who contributes what over time.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="name" className="text-sm font-medium text-slate-800">
          What should we call you?
        </label>
        <input
          id="name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Alice"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Continue
        </button>
        <p className="text-xs text-slate-500">
          Your name labels your edits. It is stored in this browser only — there are no accounts.
        </p>
      </form>
    </main>
  );
}
