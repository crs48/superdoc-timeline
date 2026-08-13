import type { YHubActivityResponse } from '@/types';

/**
 * y/hub namespaces every document as `{org}/{docid}`. One org for the whole app.
 */
export const ORG = 'superdoc-timeline';

/**
 * Base WebSocket URL of the y/hub deployment, including the path shim in front
 * of it. Public by nature (it is baked into a static bundle), so it is a build
 * variable rather than a secret.
 */
const WS_BASE = (import.meta.env.VITE_YHUB_WS_URL ?? 'ws://localhost:4403').replace(/\/$/, '');

/** Derived rather than configured twice: two URLs that must agree will disagree. */
const HTTP_BASE = WS_BASE.replace(/^ws/, 'http');

/**
 * SuperDoc v2 does not connect to `${serverUrl}/${documentId}`. It inserts a
 * protocol namespace, requesting `/api/ws/v1/{org}/sd2/v2.1/{documentId}`.
 * `server/ws-path-shim.mjs` collapses those segments into one docid so y/hub —
 * which addresses a room by exactly two path segments — can resolve the room.
 *
 * The REST activity API must therefore be queried with the collapsed docid.
 * This function is the client-side mirror of the shim's rule; the two must
 * change together.
 */
export function collapsedDocId(roomId: string): string {
  return `sd2__v2.1__${roomId}`;
}

/** What SuperDoc's `v2Collaboration.serverUrl` should be. It appends the rest. */
export function wsServerUrl(): string {
  return `${WS_BASE}/api/ws/v1/${ORG}`;
}

export interface FetchActivityOptions {
  /** Only entries at or after this unix-ms timestamp. */
  from?: number;
  signal?: AbortSignal;
}

/**
 * Read y/hub's own attribution index for a room.
 *
 * `group=true` bundles consecutive changes by the same user into one entry, so
 * continuous typing counts as one "edit burst" and a real pause starts a new
 * one. `Accept: application/json` opts out of y/hub's default lib0 encoding,
 * which is what lets the browser read this without a lib0 decoder.
 */
export async function fetchActivity(
  roomId: string,
  { from, signal }: FetchActivityOptions = {},
): Promise<YHubActivityResponse> {
  const params = new URLSearchParams({
    order: 'asc',
    group: 'true',
    groupMaxGap: '5000',
    customAttributions: 'true',
    // Per-entry deltas carry the inserted/deleted text, which is what lets the
    // chart measure characters instead of counting bursts. See weightOf().
    delta: 'true',
    limit: '2000',
  });
  if (from != null) params.set('from', String(from));

  const response = await fetch(
    `${HTTP_BASE}/api/activity/v1/${ORG}/${collapsedDocId(roomId)}?${params}`,
    { headers: { Accept: 'application/json' }, signal },
  );
  if (!response.ok) {
    throw new Error(`y/hub activity request failed: ${response.status}`);
  }
  return (await response.json()) as YHubActivityResponse;
}

/**
 * y/hub parses `customAttributions` as comma-separated `key:value` pairs, so a
 * name containing `,` or `:` would corrupt the attribution map.
 */
export function sanitizeAttributionValue(value: string): string {
  return value.replace(/[,:]/g, ' ').trim().slice(0, 60);
}
