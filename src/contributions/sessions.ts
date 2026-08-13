/**
 * The gap-compressed time axis (exploration 0004): activity is grouped into
 * sessions, idle stretches between them collapse to fixed-width "cut" seams,
 * and the whole axis always spans [0, 1] — no dead air. The piecewise-linear
 * mapping is exact both ways, which is what History Mode clicks need.
 */

export interface TimeSegment {
  /** Real-time bounds, unix ms. */
  t0: number;
  t1: number;
  /** Compressed-axis bounds in [0, 1]. */
  x0: number;
  x1: number;
  kind: 'session' | 'cut';
}

/** Quiet for longer than this and the axis cuts the gap out. */
export const SESSION_GAP_MS = 5 * 60_000;

/** Fixed seam width per cut — visible, but not *spent*. */
const CUT_FRAC = 0.015;
/** Width floor per session, so a two-second burst stays clickable. */
const MIN_SESSION_FRAC = 0.05;

/**
 * Merge activity spans into sessions and lay them out over [0, 1], width
 * proportional to active duration on top of a per-session floor:
 * wᵢ = w_min + (1 − n·w_min − m·w_seam) · dᵢ/Σd. When the floor cannot be
 * honored (pathologically many sessions) widths fall back to equal shares.
 */
export function buildSegments(
  spans: Array<{ startedAt: number; endedAt: number }>,
  gapMs: number = SESSION_GAP_MS,
): TimeSegment[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);

  const sessions: Array<{ t0: number; t1: number }> = [];
  for (const span of sorted) {
    const last = sessions[sessions.length - 1];
    const end = Math.max(span.endedAt, span.startedAt);
    if (last && span.startedAt - last.t1 <= gapMs) {
      last.t1 = Math.max(last.t1, end);
    } else {
      sessions.push({ t0: span.startedAt, t1: end });
    }
  }

  const n = sessions.length;
  const m = n - 1;
  const totalDuration = sessions.reduce((sum, s) => sum + Math.max(s.t1 - s.t0, 1), 0);
  const flexible = 1 - n * MIN_SESSION_FRAC - m * CUT_FRAC;
  const equalShare = (1 - m * CUT_FRAC) / n;

  const segments: TimeSegment[] = [];
  let x = 0;
  sessions.forEach((session, i) => {
    if (i > 0) {
      const prev = sessions[i - 1]!;
      segments.push({ t0: prev.t1, t1: session.t0, x0: x, x1: x + CUT_FRAC, kind: 'cut' });
      x += CUT_FRAC;
    }
    const width =
      flexible >= 0
        ? MIN_SESSION_FRAC + flexible * (Math.max(session.t1 - session.t0, 1) / totalDuration)
        : equalShare;
    segments.push({ t0: session.t0, t1: session.t1, x0: x, x1: x + width, kind: 'session' });
    x += width;
  });

  // Float drift means x ends near-but-not-exactly 1; pin the last edge.
  const last = segments[segments.length - 1];
  if (last) last.x1 = 1;
  return segments;
}

/** Real time → compressed x. Times inside a cut clamp to the seam's end. */
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

/** Compressed x → real time. An x inside a cut resolves to the gap's end. */
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
