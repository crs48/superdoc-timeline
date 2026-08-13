/** Stable per-browser-profile identity. Persisted; only ever sent to y/hub. */
export interface Identity {
  /**
   * crypto.randomUUID(), written once and persisted. This is the value y/hub
   * records as `yuserid`, and therefore the `by` on every activity entry.
   */
  deviceId: string;
  /** User-supplied, editable. Display only — identity never depends on it. */
  name: string;
}

/** Alias so call sites read honestly: this string IS the deviceId. */
export type ContributorId = string;

export interface Contributor {
  id: ContributorId;
  /** Most recent name seen for this id. May change; the id may not. */
  name: string;
  /** Derived deterministically from `id` so every client colours alike. */
  color: string;
}

/**
 * Wire shape of `GET /api/activity/v1/{org}/{docid}` with
 * `Accept: application/json`. Fields we don't request are absent.
 */
export interface YHubActivityEntry {
  /** Unix ms, start of the (optionally grouped) editing burst. */
  from: number;
  /** Unix ms, end of the burst. Equals `from` for a single change. */
  to: number;
  /** y/hub's `yuserid` — our deviceId. y/hub types it optional. */
  by?: string;
  /** Only present when the request sets `customAttributions=true`. */
  customAttributions?: Array<{ k: string; v: string }> | null;
}

export interface YHubActivityResponse {
  activity: YHubActivityEntry[];
}

/** Our normalized unit of contribution: one editing burst by one contributor. */
export interface ContributionEvent {
  /**
   * Stable, content-derived key: `${by}:${from}:${to}`. Polling re-fetches
   * overlapping windows, so dedupe must not depend on arrival order.
   */
  id: string;
  contributorId: ContributorId;
  startedAt: number;
  endedAt: number;
  /**
   * The chart metric. Opaque on purpose: swapping "edit bursts" for character
   * counts later touches only `normalize.ts`, not the store, bucketer, or chart.
   */
  weight: number;
}

/**
 * One x-axis point. Recharts wants each series as a sibling key on a flat
 * object, so the index signature is deliberate.
 */
export interface ActivityBucket {
  /** Bucket start, unix ms — the x value. */
  t: number;
  [contributorId: string]: number;
}

export interface ActivitySeries {
  /** Bucket width in ms; adaptive so the chart holds ~60 points. */
  bucketMs: number;
  buckets: ActivityBucket[];
  /** One `<Area>` is drawn per contributor, in this order. */
  contributors: Contributor[];
  from: number;
  to: number;
}

export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface RoomSession {
  /** nanoid(12) — the shareable identity, and the basis of y/hub's docid. */
  roomId: string;
  /** Which room mode the current mount used. Drives join-or-create retry. */
  mode: 'create' | 'join';
  status: RoomStatus;
  /** Set from onException and surfaced in the UI rather than swallowed. */
  lastError: string | null;
}
