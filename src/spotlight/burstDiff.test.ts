import { describe, expect, it } from 'vitest';
import { diffBlocks, diffOne, type BlockText } from './burstDiff';

function block(blockId: string, text: string): BlockText {
  return { blockId, text, splitFromBlockId: null, mergedIntoBlockId: null };
}

describe('diffOne', () => {
  it('returns null for identical text', () => {
    expect(diffOne('same', 'same')).toBeNull();
  });

  it('finds a pure insertion with its offset', () => {
    expect(diffOne('hello world', 'hello brave world')).toEqual({
      offset: 6,
      inserted: 'brave ',
      deleted: '',
    });
  });

  it('finds a pure deletion', () => {
    expect(diffOne('hello brave world', 'hello world')).toEqual({
      offset: 6,
      inserted: '',
      deleted: 'brave ',
    });
  });

  it('finds a replacement', () => {
    expect(diffOne('the red fox', 'the quick fox')).toEqual({
      offset: 4,
      inserted: 'quick',
      deleted: 'red',
    });
  });

  it('handles repeated characters without overlapping prefix and suffix', () => {
    // "aa" -> "aaaa": prefix and suffix scans must not double-claim chars.
    const d = diffOne('aa', 'aaaa');
    expect(d).not.toBeNull();
    expect(d!.inserted.length - d!.deleted.length).toBe(2);
  });
});

describe('diffBlocks', () => {
  it('reports changed, added, and removed blocks by id', () => {
    const before = [block('a', 'alpha'), block('b', 'beta')];
    const after = [block('a', 'alpha!'), block('c', 'gamma')];
    const changes = diffBlocks(before, after);
    expect(changes).toEqual([
      { blockId: 'a', offset: 5, inserted: '!', deleted: '' },
      { blockId: 'c', offset: 0, inserted: 'gamma', deleted: '' },
      { blockId: 'b', offset: 0, inserted: '', deleted: 'beta' },
    ]);
  });

  it('reports nothing for identical block lists', () => {
    const blocks = [block('a', 'alpha')];
    expect(diffBlocks(blocks, blocks)).toEqual([]);
  });

  it('ignores empty added blocks (a bare Enter is not a text change)', () => {
    expect(diffBlocks([], [block('a', '')])).toEqual([]);
  });
});
