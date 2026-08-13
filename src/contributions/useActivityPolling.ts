import { useEffect, useMemo, useRef } from 'react';
import { fetchActivity } from '@/collab/yhub';
import { collectContributors, normalizeActivity } from './normalize';
import { toSeries } from './bucket';
import { useActivity } from '@/store/activity';
import { useIdentity } from '@/store/identity';
import type { ActivitySeries } from '@/types';

const POLL_INTERVAL_MS = 5_000;
/** Debounce for the local-edit trigger, so a typing burst causes one refetch. */
const EDIT_REFRESH_MS = 1_200;

/**
 * Keeps the contribution series in sync with y/hub's activity index.
 *
 * Polling rather than push: 5s of latency on a chart is invisible, and it keeps
 * the attribution channel completely independent of the editor's socket — if
 * y/hub's REST API is unreachable the chart empties and the document keeps
 * working, which is the property that makes this safe.
 */
export function useActivityPolling(roomId: string | null, enabled: boolean) {
  const ingest = useActivity((s) => s.ingest);
  const setError = useActivity((s) => s.setError);
  const events = useActivity((s) => s.events);
  const contributors = useActivity((s) => s.contributors);
  const deviceId = useIdentity((s) => s.deviceId);
  const name = useIdentity((s) => s.name);

  const identityRef = useRef({ deviceId, name });
  identityRef.current = { deviceId, name };
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!roomId || !enabled) return;

    const controller = new AbortController();
    let cancelled = false;

    async function refresh() {
      if (!roomId) return;
      try {
        const { activity } = await fetchActivity(roomId, { signal: controller.signal });
        if (cancelled) return;
        ingest(normalizeActivity(activity), collectContributors(activity, identityRef.current));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : 'Could not load activity');
      }
    }

    refreshRef.current = () => void refresh();
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [roomId, enabled, ingest, setError]);

  /**
   * `onEditorUpdate` carries no author, delta, or size — it is useless as a
   * measurement, but it is a perfectly good signal that our own edit is worth
   * fetching sooner than the next tick.
   */
  const onLocalEdit = useMemo(
    () => () => {
      if (editTimer.current) clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => refreshRef.current(), EDIT_REFRESH_MS);
    },
    [],
  );

  useEffect(() => () => { if (editTimer.current) clearTimeout(editTimer.current); }, []);

  const series: ActivitySeries = useMemo(
    () => toSeries([...events.values()], contributors),
    [events, contributors],
  );

  return { series, onLocalEdit };
}
