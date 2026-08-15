/**
 * Contributor colours are derived from the deviceId rather than assigned in
 * arrival order, so every client renders the same person in the same colour
 * without any coordination.
 */
const PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#db2777', // pink
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#65a30d', // lime
];

function paletteIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % PALETTE.length;
}

export function colorForContributor(id: string): string {
  return PALETTE[paletteIndex(id)] as string;
}

/**
 * Collision-free variant for views where hue *is* identity (author threads,
 * exploration 0012 finding 4): with 8 hues, five contributors share one 79 %
 * of the time. Each id keeps its hash preference and is bumped to the next
 * free slot when taken. Ids are processed in sorted order, so every client
 * sees the same assignment regardless of arrival order. Beyond 8 ids the
 * palette wraps and collisions return — callers pair this with a top-N cut.
 */
export function assignColors(ids: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(ids)].sort();
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const id of sorted) {
    let i = paletteIndex(id);
    for (let n = 0; n < PALETTE.length && taken.has(i); n += 1) i = (i + 1) % PALETTE.length;
    taken.add(i);
    out.set(id, PALETTE[i] as string);
  }
  return out;
}

/** Short, human-scannable fallback when a contributor has never announced a name. */
export function fallbackName(id: string): string {
  return `Anonymous ${id.slice(0, 4)}`;
}
