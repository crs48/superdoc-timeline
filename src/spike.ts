/**
 * Phase 0 go/no-go spike. Not part of the app; deleted once the real
 * EditorPane exists. Answers three questions:
 *   1. Does SuperDoc v2's bundled y-websocket provider sync through y/hub?
 *   2. What does a cold joiner (no .docx blob) pass as `document.data`?
 *   3. Does `params.yauth` reach y/hub and show up as `activity[].by`?
 *
 * Drive it as: /spike.html?room=<id>&mode=create|join&user=<deviceId>&blank=1
 */
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

// Instrument every Worker SuperDoc creates, before it creates any, so the init
// handshake is visible. `worker-init-failed` is opaque from the outside.
const wireLog: unknown[] = [];
(window as unknown as { __wire: unknown[] }).__wire = wireLog;
const NativeWorker = window.Worker;
class LoggingWorker extends NativeWorker {
  constructor(url: string | URL, opts?: WorkerOptions) {
    super(url, opts);
    wireLog.push({ dir: 'new', url: String(url), type: opts?.type });
    this.addEventListener('message', (e: MessageEvent) => {
      wireLog.push({ dir: 'w->m', data: summarize(e.data) });
    });
    this.addEventListener('error', (e: ErrorEvent) => {
      wireLog.push({ dir: 'w!err', message: e.message, filename: e.filename, lineno: e.lineno });
    });
    this.addEventListener('messageerror', () => wireLog.push({ dir: 'w!msgerr' }));
  }
  postMessage(msg: unknown, ...rest: unknown[]) {
    wireLog.push({ dir: 'm->w', data: summarize(msg) });
    return (super.postMessage as (m: unknown, ...r: unknown[]) => void)(msg, ...rest);
  }
}
function summarize(d: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(d, (_k, v) => {
        if (v instanceof Error) return { __error: v.name, message: v.message, stack: v.stack?.slice(0, 400) };
        if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `<binary ${(v as ArrayBufferView).byteLength ?? ''}>`;
        return v;
      }),
    );
  } catch {
    return String(d);
  }
}
window.Worker = LoggingWorker as unknown as typeof Worker;

const qs = new URLSearchParams(location.search);
const room = qs.get('room') ?? 'spike-room';
const mode = (qs.get('mode') ?? 'create') as 'create' | 'join';
const user = qs.get('user') ?? 'device-a';
const blank = qs.get('blank') === '1';

const logEl = document.getElementById('log')!;
const results: Record<string, unknown> = { room, mode, user, blank };

function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 1)))
    .join(' ');
  logEl.textContent += `${line}\n`;
  console.log('[spike]', ...args);
}

// Exposed so the driving harness can read structured results out of the page.
(window as unknown as { __spike: Record<string, unknown> }).__spike = results;

async function main() {
  // A joiner following a share link has no file. Test the documented shape
  // (`data: Blob`) against the cold-join shape in the same harness.
  let data: Blob | null = null;
  if (!blank) {
    data = await fetch(`${import.meta.env.BASE_URL}sample.docx`).then((r) => r.blob());
    log('loaded sample.docx', data.size, 'bytes');
  } else {
    log('cold join: passing data = null');
  }

  const serverUrl = 'ws://localhost:4400/api/ws/v1/superdoc-timeline';
  log('connecting', { serverUrl, documentId: room, roomMode: mode });

  const base = import.meta.env.BASE_URL;
  const sd = new SuperDoc({
    selector: '#editor',
    workerUrls: {
      document: `${base}superdoc-workers/document.js`,
      collaboration: `${base}superdoc-workers/collaboration.js`,
      reviewIndex: `${base}superdoc-workers/reviewIndex.js`,
    },
    workerStartupTimeoutMs: 120_000,
    user: { id: user, name: `User ${user}` },
    document: {
      id: room,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data,
      v2Collaboration: {
        documentId: room,
        serverUrl,
        roomMode: mode,
        params: { yauth: user, customAttributions: `name:User-${user}` },
      },
    },
    onReady: () => {
      results.ready = true;
      log('EVENT onReady');
    },
    onCollaborationReady: () => {
      results.collaborationReady = true;
      log('EVENT onCollaborationReady');
      // Question left open in the exploration: is the Y.Doc reachable on the
      // main thread in v2, or is it worker-only?
      const inst = sd as unknown as { ydoc?: unknown; provider?: unknown };
      results.hasYdoc = inst.ydoc != null;
      results.hasProvider = inst.provider != null;
      log('main-thread ydoc?', results.hasYdoc, 'provider?', results.hasProvider);
    },
    onEditorUpdate: () => {
      results.editorUpdates = ((results.editorUpdates as number) ?? 0) + 1;
    },
    onException: (payload: { error: unknown }) => {
      const error = payload.error as Record<string, unknown> | undefined;
      const code = String(error?.code ?? error);
      results.exception = code;
      results.exceptionDetail = {
        payloadCode: (payload as unknown as { code?: string }).code,
        errorMessage: String((error as unknown as { message?: string })?.message ?? ''),
        keys: error ? Object.keys(error) : [],
        code: error?.code,
        name: error?.name,
        cause: String((error?.cause as { message?: string })?.message ?? error?.cause ?? ''),
        payloadKeys: Object.keys(payload),
      };
      log('EVENT onException', code, JSON.stringify(results.exceptionDetail));
    },
  });

  (window as unknown as { __sd: unknown }).__sd = sd;
}

main().catch((e) => log('FATAL', String(e)));
