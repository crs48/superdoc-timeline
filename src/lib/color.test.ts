import { describe, expect, it } from 'vitest';
import { assignColors, colorForContributor } from './color';

describe('assignColors', () => {
  it('keeps the hash colour when nothing collides', () => {
    const ids = ['alpha', 'bravo'];
    const map = assignColors(ids);
    // At least one keeps its preference; both are distinct.
    expect(new Set(map.values()).size).toBe(2);
    expect(ids.some((id) => map.get(id) === colorForContributor(id))).toBe(true);
  });

  it('never assigns two of ≤ 8 contributors the same hue', () => {
    // Enough ids that hash collisions are certain in the raw palette.
    const ids = Array.from({ length: 8 }, (_, i) => `device-${i * 7919}`);
    const raw = new Set(ids.map(colorForContributor));
    expect(raw.size).toBeLessThan(8); // the problem being fixed
    const map = assignColors(ids);
    expect(new Set(map.values()).size).toBe(8);
  });

  it('is independent of input order', () => {
    const ids = ['c', 'a', 'b', 'd', 'e'];
    const a = assignColors(ids);
    const b = assignColors([...ids].reverse());
    for (const id of ids) expect(a.get(id)).toBe(b.get(id));
  });
});
