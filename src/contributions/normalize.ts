import type {
  Contributor,
  ContributionEvent,
  YHubActivityEntry,
} from '@/types';
import { colorForContributor, fallbackName } from '@/lib/color';

/**
 * The chart metric: attributed characters when the server can see them, one
 * per burst otherwise — which for SuperDoc traffic means bursts.
 *
 * With `delta=true` an activity entry carries its ops, and an op belonging to
 * this entry carries an `attribution`; ops echoing surrounding context do not.
 * Counting the echoes triple-counts (a live two-writer probe measured 2100
 * "naive" chars against 100+100 real), so only attributed ops count. But y/hub
 * renders a SuperDoc v2 room's delta as its content-unit *metadata*, never the
 * typed text, so fetchActivity doesn't request deltas today and every real
 * entry takes the `|| 1` fallback. The delta walk stays because it is proven
 * against plain text roots and is the upgrade path if y/hub learns to unfold
 * SuperDoc content units. Everything downstream treats `weight` as opaque, so
 * the definition of "volume" lives here and nowhere else.
 */
export function weightOf(entry: YHubActivityEntry): number {
  let chars = 0;
  for (const op of entry.delta?.children ?? []) {
    if (typeof op.insert === 'string' && op.attribution?.insert?.length) {
      chars += op.insert.length;
    }
    if (typeof op.delete === 'number' && op.attribution?.delete?.length) {
      chars += op.delete;
    }
  }
  // An entry whose delta is missing or undecodable is still one edit.
  return chars || 1;
}

/** y/hub omits `by` when a change has no attribution; keep those visible. */
const UNATTRIBUTED = 'unattributed';

export function normalizeActivity(entries: YHubActivityEntry[]): ContributionEvent[] {
  return entries.map((entry) => {
    const contributorId = entry.by && entry.by.length > 0 ? entry.by : UNATTRIBUTED;
    // `to` can precede `from` only if the server clock moved; clamp rather than
    // producing a negative-width burst that would break bucketing.
    const startedAt = entry.from;
    const endedAt = Math.max(entry.to, entry.from);
    return {
      id: `${contributorId}:${startedAt}:${endedAt}`,
      contributorId,
      startedAt,
      endedAt,
      weight: weightOf(entry),
    };
  });
}

/**
 * Names travel as a y/hub custom attribution (`name:Alice`) on the connection
 * that made the change, so the display name for a contributor is whatever they
 * last announced. The deviceId is the identity; the name is only a label.
 */
export function collectContributors(
  entries: YHubActivityEntry[],
  localIdentity?: { deviceId: string; name: string },
): Contributor[] {
  const names = new Map<string, string>();

  for (const entry of entries) {
    const id = entry.by && entry.by.length > 0 ? entry.by : UNATTRIBUTED;
    if (!names.has(id)) names.set(id, '');
    const announced = entry.customAttributions?.find((a) => a.k === 'name')?.v;
    if (announced) names.set(id, announced);
  }

  // The local user should be named immediately, before any of their edits have
  // been persisted and polled back.
  if (localIdentity) {
    const existing = names.get(localIdentity.deviceId);
    if (!existing) names.set(localIdentity.deviceId, localIdentity.name);
  }

  return [...names.entries()]
    .map(([id, name]) => ({
      id,
      name: name || (id === UNATTRIBUTED ? 'Unattributed' : fallbackName(id)),
      color: colorForContributor(id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
