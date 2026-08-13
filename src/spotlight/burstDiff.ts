import * as Y from 'yjs';
import { fetchDocumentAt } from '@/history/fetchDocumentAt';

/**
 * One story block of a reconstructed document, keeping the identifiers the
 * schema exposes. `blockId` is the native DOCX paragraph id — stable across
 * edits, which is what lets a diff of two reconstructions name "the same
 * paragraph". Split/merge lineage lets a fold treat a paragraph's halves as
 * one row (exploration 0004, R3).
 */
export interface BlockText {
  blockId: string;
  text: string;
  splitFromBlockId: string | null;
  mergedIntoBlockId: string | null;
}

/**
 * `extractParagraphs` (M5), extended to keep block identity. Same walk, same
 * safety posture: `instanceof` checks everywhere, so schema drift yields
 * fewer blocks, never a crash.
 */
export function extractBlockTexts(doc: Y.Doc): BlockText[] {
  const out: BlockText[] = [];
  const content = doc.getMap('content');
  for (const shard of content.values()) {
    if (!(shard instanceof Y.Map)) continue;
    const meta = shard.get('meta');
    if (!(meta instanceof Y.Map) || meta.get('shardKind') !== 'story') continue;
    const blocks = shard.get('blocks');
    if (!(blocks instanceof Y.Array)) continue;
    for (const block of blocks) {
      if (!(block instanceof Y.Map)) continue;
      const text = block.get('text');
      const blockId = block.get('blockId');
      if (!(text instanceof Y.Text) || typeof blockId !== 'string') continue;
      const splitFrom = block.get('splitFromBlockId');
      const mergedInto = block.get('mergedIntoBlockId');
      out.push({
        blockId,
        text: text.toString(),
        splitFromBlockId: typeof splitFrom === 'string' ? splitFrom : null,
        mergedIntoBlockId: typeof mergedInto === 'string' ? mergedInto : null,
      });
    }
  }
  return out;
}

/** One contiguous change to one block, in the coordinates of the AFTER text. */
export interface BurstChange {
  blockId: string;
  offset: number;
  inserted: string;
  deleted: string;
}

/**
 * Common prefix/suffix trim — exact for a single contiguous edit, which is
 * what one burst by one author overwhelmingly is. A burst that edited two
 * separate places in one block reports one spanning change: acceptable for a
 * highlight (it covers both) and honest as a before → after account.
 */
export function diffOne(
  before: string,
  after: string,
): { offset: number; inserted: string; deleted: string } | null {
  if (before === after) return null;
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    offset: prefix,
    deleted: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
  };
}

/** Diff two block lists keyed by blockId. Pure; exported for tests. */
export function diffBlocks(before: BlockText[], after: BlockText[]): BurstChange[] {
  const prev = new Map(before.map((b) => [b.blockId, b.text]));
  const changes: BurstChange[] = [];
  for (const blk of after) {
    const was = prev.get(blk.blockId);
    prev.delete(blk.blockId);
    if (was === undefined) {
      if (blk.text.length > 0) {
        changes.push({ blockId: blk.blockId, offset: 0, inserted: blk.text, deleted: '' });
      }
    } else {
      const d = diffOne(was, blk.text);
      if (d) changes.push({ blockId: blk.blockId, ...d });
    }
  }
  for (const [blockId, text] of prev) {
    changes.push({ blockId, offset: 0, inserted: '', deleted: text });
  }
  return changes;
}

/**
 * Reconstruction cache. History is immutable, so an entry never goes stale —
 * the LRU bound only caps memory. Rejected fetches are evicted immediately so
 * an abort or a network blip is retryable.
 */
const blocksCache = new Map<string, Promise<BlockText[]>>();
const BLOCKS_CACHE_MAX = 64;

export function blocksAt(roomId: string, ts: number, signal?: AbortSignal): Promise<BlockText[]> {
  const key = `${roomId}@${ts}`;
  const hit = blocksCache.get(key);
  if (hit) return hit;

  const promise = fetchDocumentAt(roomId, ts, signal).then((doc) => {
    const blocks = extractBlockTexts(doc);
    doc.destroy();
    return blocks;
  });
  blocksCache.set(key, promise);
  promise.catch(() => blocksCache.delete(key));
  if (blocksCache.size > BLOCKS_CACHE_MAX) {
    const oldest = blocksCache.keys().next().value;
    if (oldest) blocksCache.delete(oldest);
  }
  return promise;
}

/**
 * What one burst changed, derived from the document just before it began and
 * at its end. An empty list is a real result: the burst changed no story
 * text (formatting, tables, images) — callers must keep it visible rather
 * than dropping the activity (0004, R2).
 */
export async function diffForBurst(
  roomId: string,
  burst: { startedAt: number; endedAt: number },
  signal?: AbortSignal,
): Promise<BurstChange[]> {
  const [before, after] = await Promise.all([
    blocksAt(roomId, burst.startedAt - 1, signal),
    blocksAt(roomId, burst.endedAt, signal),
  ]);
  return diffBlocks(before, after);
}
