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

export function colorForContributor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length] as string;
}

/** Short, human-scannable fallback when a contributor has never announced a name. */
export function fallbackName(id: string): string {
  return `Anonymous ${id.slice(0, 4)}`;
}
