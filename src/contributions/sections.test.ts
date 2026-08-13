import { describe, expect, it } from 'vitest';
import { blockMass, buildSectionIndex, partitionSections } from './sections';
import type { BlockText } from '@/spotlight/burstDiff';

function block(blockId: string, len: number): BlockText {
  return {
    blockId,
    text: 'x'.repeat(len),
    splitFromBlockId: null,
    mergedIntoBlockId: null,
  };
}

const doc = (lens: number[]) => lens.map((len, i) => block(`b${i}`, len));

describe('partitionSections', () => {
  it('returns nothing for an empty document', () => {
    expect(partitionSections([], 5)).toEqual([]);
  });

  it('never exceeds maxRows', () => {
    const blocks = doc(Array.from({ length: 40 }, () => 120));
    expect(partitionSections(blocks, 5)).toHaveLength(5);
  });

  it('gives every block its own section when the document is smaller than the cap', () => {
    const sections = partitionSections(doc([100, 100, 100]), 8);
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.blockIds)).toEqual([['b0'], ['b1'], ['b2']]);
  });

  it('covers every block exactly once, contiguously and in order', () => {
    const blocks = doc([500, 30, 80, 400, 60, 90, 250, 10, 10, 300]);
    const sections = partitionSections(blocks, 4);
    const flattened = sections.flatMap((s) => s.blockIds);
    expect(flattened).toEqual(blocks.map((b) => b.blockId));
  });

  it('balances by mass within the greedy bound (target + max block mass)', () => {
    const blocks = doc([500, 30, 80, 400, 60, 90, 250, 10, 10, 300]);
    const k = 4;
    const sections = partitionSections(blocks, k);
    const total = blocks.reduce((sum, b) => sum + blockMass(b.text), 0);
    const target = total / k;
    const maxMass = Math.max(...blocks.map((b) => blockMass(b.text)));
    for (const section of sections) {
      expect(section.mass).toBeLessThanOrEqual(target + maxMass);
    }
    expect(sections.reduce((sum, s) => sum + s.mass, 0)).toBe(total);
  });

  it('labels a section with its first non-empty snippet and paragraph range', () => {
    const blocks = [block('a', 0), { ...block('b', 0), text: 'Hello brave new world of text' }];
    const [section] = partitionSections(blocks, 1);
    expect(section?.label).toBe('Hello brave new wo… · ¶1–2');
  });

  it('labels a single-block section without a range dash', () => {
    const [section] = partitionSections([{ ...block('a', 0), text: 'Intro' }], 3);
    expect(section?.label).toBe('Intro · ¶1');
  });
});

describe('buildSectionIndex', () => {
  it('maps every member block to its section index', () => {
    const sections = partitionSections(doc([100, 100, 100, 100]), 2);
    const index = buildSectionIndex(sections);
    expect(index.get('b0')).toBe(0);
    expect(index.get('b3')).toBe(sections.length - 1);
    expect(index.get('missing')).toBeUndefined();
  });
});
