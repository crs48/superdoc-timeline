import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { setPendingUpload } from '@/store/room';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function UploadPanel() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx') && file.type !== DOCX_TYPE) {
      setError('That does not look like a .docx file.');
      return;
    }
    setError(null);
    setPendingUpload(file);
    // 12 chars rather than a 36-char UUID: this ends up in a link people paste.
    navigate(`/d/${nanoid(12)}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Start a document</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload a <code className="rounded bg-slate-100 px-1">.docx</code>. You will get a link
          anyone can open to edit it with you.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border-2 border-dashed border-slate-300 px-6 py-12 text-sm text-slate-600 hover:border-blue-400 hover:bg-slate-50"
      >
        Choose a Word document
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <p className="text-xs text-slate-500">
        No sign-in, and no permissions model: anyone with the link can edit. Don't upload anything
        sensitive.
      </p>
    </main>
  );
}
