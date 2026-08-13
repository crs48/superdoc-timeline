/**
 * The organic paint of the edit map (exploration 0005 R3): every burst drops
 * a smooth raised-cosine bump at its x-position; per (section × contributor)
 * the bumps sum into an intensity series sampled on a fixed pixel grid,
 * zeroed inside cut seams, and rendered as a Catmull-Rom-smoothed area path.
 * Pure functions — the SVG layer just calls them.
 */

/** Sample cadence, px. Fixed so morphing can lerp arrays index-wise. */
export const SAMPLE_STEP = 4;
/** Kernel half-width floor, px — a keystroke-sized burst still makes a lobe
 *  wide enough to read as a mound rather than a spike. */
export const SIGMA_FLOOR = 14;
/** Lobes may rise past their row top by this factor (joyplot overflow). */
export const ROW_OVERFLOW = 1.35;

/** Raised-cosine bump: support (c−w, c+w), peak 1 at c, no tails. */
export function bump(x: number, c: number, w: number): number {
  return Math.abs(x - c) >= w ? 0 : 0.5 * (1 + Math.cos((Math.PI * (x - c)) / w));
}

export interface BurstMarkSpan {
  x0: number;
  x1: number;
  weight: number;
}

/**
 * Sum burst kernels into an intensity series over [0, contentW]. Kernels are
 * centered on the burst's midpoint with half-width max(SIGMA_FLOOR,
 * span/2 + SIGMA_FLOOR); samples inside cuts are forced to zero so lobes
 * never bleed across a collapsed gap.
 */
export function sampleIntensity(
  bursts: BurstMarkSpan[],
  contentW: number,
  inCut: (x: number) => boolean,
  step: number = SAMPLE_STEP,
): Float32Array {
  const n = Math.max(2, Math.ceil(contentW / step) + 1);
  const out = new Float32Array(n);
  for (const b of bursts) {
    const c = (b.x0 + b.x1) / 2;
    const w = Math.max(SIGMA_FLOOR, (b.x1 - b.x0) / 2 + SIGMA_FLOOR);
    const from = Math.max(0, Math.floor((c - w) / step));
    const to = Math.min(n - 1, Math.ceil((c + w) / step));
    for (let i = from; i <= to; i += 1) {
      out[i] = out[i]! + b.weight * bump(i * step, c, w);
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (out[i]! > 0 && inCut(i * step)) out[i] = 0;
  }
  return out;
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * Closed area path over the samples: baseline → Catmull-Rom curve through
 * (i·step, baseY − samples[i]·scale) → baseline. Heights clamp to
 * `maxRise` so one hot burst cannot escape the chart (0005, R5).
 */
export function terrainPath(
  samples: Float32Array | number[],
  baseY: number,
  scale: number,
  maxRise: number,
  step: number = SAMPLE_STEP,
): string {
  const n = samples.length;
  if (n < 2) return '';
  const y = (i: number) => baseY - Math.min(samples[i]! * scale, maxRise);
  const x = (i: number) => i * step;

  let d = `M${fmt(x(0))},${fmt(baseY)} L${fmt(x(0))},${fmt(y(0))}`;
  for (let i = 0; i < n - 1; i += 1) {
    // Catmull-Rom → cubic Bézier with clamped neighbor indices.
    const p0 = Math.max(0, i - 1);
    const p3 = Math.min(n - 1, i + 2);
    const c1x = x(i) + (x(i + 1) - x(p0)) / 6;
    const c1y = y(i) + (y(i + 1) - y(p0)) / 6;
    const c2x = x(i + 1) - (x(p3) - x(i)) / 6;
    const c2y = y(i + 1) - (y(p3) - y(i)) / 6;
    d += ` C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(x(i + 1))},${fmt(y(i + 1))}`;
  }
  d += ` L${fmt(x(n - 1))},${fmt(baseY)} Z`;
  return d;
}

/**
 * Normalization ceiling for terrain heights: the 95th percentile of the
 * per-series maxima, so one enormous burst cannot flatten every other lobe
 * (heights above it clamp to the overflow cap instead).
 */
export function chartCeiling(seriesMaxima: number[]): number {
  const positive = seriesMaxima.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 1;
  const idx = Math.min(positive.length - 1, Math.floor(positive.length * 0.95));
  return positive[idx]!;
}
