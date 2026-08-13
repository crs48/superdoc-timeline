import type {
  Contributor,
  ContributionEvent,
  YHubActivityEntry,
} from '@/types';
import { colorForContributor, fallbackName } from '@/lib/color';

/**
 * The chart metric.
 *
 * y/hub's activity entries carry a time span, not a size, so "edit volume" has
 * to be derived. With `group=true&groupMaxGap=5000` one entry is one editing
 * burst, and counting bursts is coarse but monotone with effort — a fair,
 * honest proxy that costs nothing extra. Character-accurate volume needs
 * `delta=true` plus a delta walk; swapping to it means changing only this
 * function, because everything downstream treats `weight` as opaque.
 */
function weightOf(_entry: YHubActivityEntry): number {
  return 1;
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
