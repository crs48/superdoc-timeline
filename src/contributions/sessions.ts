/**
 * The gap-compressed, elastically sized time axis (explorations 0004/0005):
 * activity is grouped into sessions, idle stretches between them collapse to
 * fixed-width "cut" seams, and each session earns a pixel budget from its
 * active duration and burst count. Small histories stretch to fill the
 * container exactly (0004's behavior); dense histories grow past it and
 * scroll. The piecewise-linear mapping is exact both ways, which is what
 * History Mode clicks need.
 */

export interface TimeSegment {
  /** Real-time bounds, unix ms. */
  t0: number;
  t1: number;
  /** Compressed-axis bounds, px. */
  x0: number;
  x1: number;
  kind: 'session' | 'cut';
}

/** Quiet for longer than this and the axis cuts the gap out. */
export const SESSION_GAP_MS = 5 * 60_000;

/** Legibility budgets (0005 R2): a session is never narrower than any of
 *  these floors, so time stays readable and bursts keep room to render. */
export const PX_PER_ACTIVE_MIN = 24;
export const MIN_BURST_PX = 10;
export const MIN_SESSION_PX = 48;
/** Fixed seam width per cut — visible, but not *spent*. */
export const SEAM_PX = 14;

interface Span {
  startedAt: number;
  endedAt: number;
}

/** Merge activity spans into [t0, t1] sessions separated by > gapMs. */
export function mergeSessions(spans: Span[], gapMs: number = SESSION_GAP_MS): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);
  const sessions: Span[] = [];
  for (const span of sorted) {
    const last = sessions[sessions.length - 1];
    const end = Math.max(span.endedAt, span.startedAt);
    if (last && span.startedAt - last.endedAt <= gapMs) {
      last.endedAt = Math.max(last.endedAt, end);
    } else {
      sessions.push({ startedAt: span.startedAt, endedAt: end });
    }
  }
  return sessions;
}

/**
 * Lay sessions out in pixels. Each session's budget is
 * max(MIN_SESSION_PX, activeMinutes × PX_PER_ACTIVE_MIN, bursts × MIN_BURST_PX);
 * when the budgets underfill the container the slack is returned
 * duration-proportionally (so a short history still fills the dock), and when
 * they overflow it the content grows and the caller scrolls.
 */
export function layoutSessions(
  spans: Span[],
  bursts: Span[],
  containerW: number,
  gapMs: number = SESSION_GAP_MS,
): { contentW: number; segments: TimeSegment[] } {
  const sessions = mergeSessions(spans, gapMs);
  if (sessions.length === 0) return { contentW: containerW, segments: [] };

  const durations = sessions.map((s) => Math.max(s.endedAt - s.startedAt, 1));
  const budgets = sessions.map((s, i) => {
    const inSession = bursts.filter(
      (b) => b.startedAt >= s.startedAt && b.startedAt <= s.endedAt,
    ).length;
    return Math.max(
      MIN_SESSION_PX,
      (durations[i]! / 60_000) * PX_PER_ACTIVE_MIN,
      inSession * MIN_BURST_PX,
    );
  });

  const seams = (sessions.length - 1) * SEAM_PX;
  const natural = budgets.reduce((a, b) => a + b, 0) + seams;
  const totalDuration = durations.reduce((a, b) => a + b, 0);
  const slack = Math.max(0, containerW - natural);
  const widths = budgets.map((w, i) => w + slack * (durations[i]! / totalDuration));
  const contentW = Math.max(containerW, natural);

  const segments: TimeSegment[] = [];
  let x = 0;
  sessions.forEach((session, i) => {
    if (i > 0) {
      const prev = sessions[i - 1]!;
      segments.push({ t0: prev.endedAt, t1: session.startedAt, x0: x, x1: x + SEAM_PX, kind: 'cut' });
      x += SEAM_PX;
    }
    segments.push({
      t0: session.startedAt,
      t1: session.endedAt,
      x0: x,
      x1: x + widths[i]!,
      kind: 'session',
    });
    x += widths[i]!;
  });

  // Float drift means x ends near-but-not-exactly contentW; pin the last edge.
  const last = segments[segments.length - 1];
  if (last) last.x1 = contentW;
  return { contentW, segments };
}

/** Real time → x px. Times inside a cut clamp to the seam's end. */
export function xOf(t: number, segments: TimeSegment[]): number {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return 0;
  if (t <= first.t0) return first.x0;
  if (t >= last.t1) return last.x1;
  for (const seg of segments) {
    if (t > seg.t1) continue;
    if (seg.kind === 'cut') return seg.x1;
    const span = seg.t1 - seg.t0;
    return span <= 0 ? seg.x0 : seg.x0 + ((t - seg.t0) / span) * (seg.x1 - seg.x0);
  }
  return last.x1;
}

/** x px → real time. An x inside a cut resolves to the gap's end. */
export function tOf(x: number, segments: TimeSegment[]): number {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return 0;
  if (x <= first.x0) return first.t0;
  if (x >= last.x1) return last.t1;
  for (const seg of segments) {
    if (x > seg.x1) continue;
    if (seg.kind === 'cut') return seg.t1;
    const span = seg.x1 - seg.x0;
    return span <= 0 ? seg.t0 : seg.t0 + ((x - seg.x0) / span) * (seg.t1 - seg.t0);
  }
  return last.t1;
}
