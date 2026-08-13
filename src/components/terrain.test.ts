import { describe, expect, it } from 'vitest';
import { SAMPLE_STEP, bump, chartCeiling, sampleIntensity, terrainPath } from './terrain';

describe('bump', () => {
  it('peaks at 1 at its center and is 0 outside its support', () => {
    expect(bump(50, 50, 10)).toBe(1);
    expect(bump(60, 50, 10)).toBe(0);
    expect(bump(39.9, 50, 10)).toBe(0);
    expect(bump(55, 50, 10)).toBeGreaterThan(0);
    expect(bump(55, 50, 10)).toBeLessThan(1);
  });
});

describe('sampleIntensity', () => {
  const noCut = () => false;

  it('produces a lobe around a single burst and zero far away', () => {
    const s = sampleIntensity([{ x0: 96, x1: 104, weight: 1 }], 400, noCut);
    const at = (x: number) => s[Math.round(x / SAMPLE_STEP)]!;
    expect(at(100)).toBeGreaterThan(0.9);
    expect(at(300)).toBe(0);
  });

  it('sums overlapping bursts (same-author lobes fuse)', () => {
    const one = sampleIntensity([{ x0: 100, x1: 100, weight: 1 }], 400, noCut);
    const two = sampleIntensity(
      [
        { x0: 100, x1: 100, weight: 1 },
        { x0: 100, x1: 100, weight: 1 },
      ],
      400,
      noCut,
    );
    const i = Math.round(100 / SAMPLE_STEP);
    expect(two[i]!).toBeCloseTo(2 * one[i]!, 5);
  });

  it('zeroes samples inside cuts so lobes never bleed across seams', () => {
    const inCut = (x: number) => x >= 100 && x <= 120;
    const s = sampleIntensity([{ x0: 96, x1: 118, weight: 1 }], 400, inCut);
    for (let x = 100; x <= 120; x += SAMPLE_STEP) {
      expect(s[Math.round(x / SAMPLE_STEP)]!).toBe(0);
    }
    expect(s[Math.round(96 / SAMPLE_STEP)]!).toBeGreaterThan(0);
  });
});

describe('terrainPath', () => {
  it('opens and closes on the baseline', () => {
    const d = terrainPath([0, 1, 2, 1, 0], 100, 10, 50);
    expect(d.startsWith('M0,100')).toBe(true);
    expect(d.endsWith(',100 Z')).toBe(true);
    expect(d).toContain('C');
  });

  it('clamps peaks to the overflow cap', () => {
    const d = terrainPath([0, 100, 0], 100, 10, 30);
    // The peak would be y = 100 - 1000; the cap holds it at 100 - 30 = 70.
    expect(d).toContain('70');
    expect(d).not.toContain('-900');
  });

  it('returns an empty path for degenerate input', () => {
    expect(terrainPath([5], 100, 1, 10)).toBe('');
  });
});

describe('chartCeiling', () => {
  it('takes the 95th percentile of positive maxima', () => {
    const maxima = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(chartCeiling(maxima)).toBe(96);
  });

  it('ignores zero series and never returns 0', () => {
    expect(chartCeiling([0, 0, 0])).toBe(1);
    expect(chartCeiling([])).toBe(1);
  });
});
