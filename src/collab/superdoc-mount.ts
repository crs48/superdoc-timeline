import { SuperDoc } from 'superdoc';
import type { Identity } from '@/types';
import { sanitizeAttributionValue, wsServerUrl } from './yhub';

/**
 * SuperDoc v2 resolves its three Web Worker bundles relative to its own module
 * URL, which under pnpm lands on a virtual-store path the dev server will not
 * serve. `scripts/copy-superdoc-workers.mjs` copies them into `public/`, and
 * these URLs are built from BASE_URL so they also stay correct under the
 * GitHub Pages subpath.
 */
function workerUrls() {
  const base = import.meta.env.BASE_URL;
  return {
    document: `${base}superdoc-workers/document.js`,
    collaboration: `${base}superdoc-workers/collaboration.js`,
    reviewIndex: `${base}superdoc-workers/reviewIndex.js`,
  };
}

/** Stable diagnostic codes SuperDoc v2 reports through `onException`. */
const ROOM_MISSING = 'collaboration-v2-room-missing';
const ROOM_EXISTS = 'collaboration-v2-room-already-exists';

export interface MountRoomOptions {
  el: HTMLElement;
  roomId: string;
  identity: Identity;
  /**
   * The uploaded DOCX when creating, or a blank document when joining.
   * v2 rejects the mount outright if `data` is null, even for `roomMode: 'join'`,
   * so a joiner must still supply bytes — the room's real content arrives over
   * the wire and replaces them.
   */
  data: Blob;
  mode: 'create' | 'join';
  onReady: () => void;
  /**
   * v2 has no join-or-create: creating an existing room or joining a missing one
   * fails, and retrying requires a *fresh* editor instance. The caller remounts.
   */
  onRetry: (nextMode: 'create' | 'join') => void;
  onError: (message: string) => void;
  onEdit: () => void;
}

export function mountRoom(options: MountRoomOptions): SuperDoc {
  const { el, roomId, identity, data, mode } = options;

  return new SuperDoc({
    selector: el,
    workerUrls: workerUrls(),
    user: { id: identity.deviceId, name: identity.name },
    document: {
      id: roomId,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data,
      v2Collaboration: {
        // providerType defaults to 'y-websocket'.
        documentId: roomId,
        serverUrl: wsServerUrl(),
        roomMode: mode,
        params: {
          // Becomes y/hub's `yuserid`, and therefore `activity[].by`.
          yauth: identity.deviceId,
          // Carries the display name alongside the id, so other clients can
          // label the chart without us running a user directory.
          customAttributions: `name:${sanitizeAttributionValue(identity.name)}`,
        },
      },
    },
    onCollaborationReady: () => options.onReady(),
    onEditorUpdate: () => options.onEdit(),
    onException: (payload) => {
      // The machine-readable reason is on the payload, not on `error`.
      const code = String((payload as unknown as { code?: string }).code ?? '');
      const message =
        String((payload.error as unknown as { message?: string })?.message ?? '') || code;

      if (code === ROOM_MISSING || message.includes(ROOM_MISSING)) {
        options.onRetry('create');
        return;
      }
      if (code === ROOM_EXISTS || message.includes(ROOM_EXISTS)) {
        options.onRetry('join');
        return;
      }
      options.onError(message || 'SuperDoc could not open this room.');
    },
  });
}
