import { describe, expect, it } from 'vitest';
import { normalizeActivity, weightOf } from './normalize';
import type { YHubActivityEntry } from '@/types';

/**
 * Shapes below are taken from live y/hub responses: an entry's delta carries
 * the authored op (with `attribution`) plus context ops echoing earlier text
 * (without). The whole point of weightOf is to not count the echoes.
 */
describe('weightOf', () => {
  it('counts only attributed inserts, not echoed context', () => {
    const entry: YHubActivityEntry = {
      from: 1786646663274,
      to: 1786646663274,
      by: 'device-a',
      delta: {
        type: 'delta',
        children: [
          {
            type: 'insert',
            insert: 'hello from alpha', // 16 chars, authored
            attribution: { insert: ['device-a'], insertAt: 1786646663274 },
          },
          { type: 'insert', insert: 'hello from control' }, // context echo — not ours
        ],
      },
    };
    expect(weightOf(entry)).toBe(16);
  });

  it('counts attributed deletes', () => {
    const entry: YHubActivityEntry = {
      from: 1,
      to: 1,
      by: 'device-a',
      delta: {
        type: 'delta',
        children: [
          { type: 'delete', delete: 7, attribution: { delete: ['device-a'] } },
          { type: 'insert', insert: 'context stays' },
        ],
      },
    };
    expect(weightOf(entry)).toBe(7);
  });

  it('falls back to 1 when the delta is missing or has no attributed ops', () => {
    expect(weightOf({ from: 1, to: 1, by: 'device-a' })).toBe(1);
    expect(
      weightOf({
        from: 1,
        to: 1,
        by: 'device-a',
        delta: { type: 'delta', children: [{ type: 'insert', insert: 'echo only' }] },
      }),
    ).toBe(1);
  });

  it('ignores non-string inserts (embeds) even when attributed', () => {
    const entry: YHubActivityEntry = {
      from: 1,
      to: 1,
      by: 'device-a',
      delta: {
        type: 'delta',
        children: [{ type: 'insert', insert: { image: 'x' }, attribution: { insert: ['device-a'] } }],
      },
    };
    expect(weightOf(entry)).toBe(1);
  });
});

describe('normalizeActivity', () => {
  it('threads the character weight onto the event', () => {
    const [event] = normalizeActivity([
      {
        from: 10,
        to: 20,
        by: 'device-a',
        delta: {
          type: 'delta',
          children: [{ type: 'insert', insert: 'abcde', attribution: { insert: ['device-a'] } }],
        },
      },
    ]);
    expect(event?.weight).toBe(5);
    expect(event?.id).toBe('device-a:10:20');
  });
});
