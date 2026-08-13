import type { BlockText } from '@/spotlight/burstDiff';

/**
 * One y-axis row of the edit map: a contiguous run of document blocks,
 * sized so that at most `maxRows` sections ever exist — the row count is
 * derived from the measured chart height, never from the document
 * (exploration 0005: "only as many rows as fit without overlapping").
 */
export interface DocSection {
  index: number;
  /** Contiguous, in document order. */
  blockIds: string[];
  /** "First-block snippet · ¶a–b" */
  label: string;
  /** Σ clamp(len, 40, 400) over member blocks — drives relative row height. */
  mass: number;
}

/** Per-block contribution to a section's mass; clamped so one giant
 *  paragraph cannot swallow the axis and an empty one still occupies space. */
export function blockMass(text: string): number {
  return Math.min(Math.max(text.length, 40), 400);
}

const SNIPPET_LEN = 18;

function labelFor(blocks: BlockText[], start: number, end: number): string {
  const range = start === end ? `¶${start + 1}` : `¶${start + 1}–${end + 1}`;
  const first = blocks
    .slice(start, end + 1)
    .find((b) => b.text.trim().length > 0);
  if (!first) return range;
  const trimmed = first.text.trim().replace(/\s+/g, ' ');
  const snippet = trimmed.length > SNIPPET_LEN ? `${trimmed.slice(0, SNIPPET_LEN)}…` : trimmed;
  return `${snippet} · ${range}`;
}

/**
 * Greedy linear partition of the document into at most `maxRows` contiguous
 * sections balanced by text mass. Greedy against the ideal mass Σ/k is
 * bounded at (ideal + max block mass) per section — plenty for a chart row,
 * and ~15 lines where the DP-optimal version is not (0005, finding 1).
 */
export function partitionSections(blocks: BlockText[], maxRows: number): DocSection[] {
  if (blocks.length === 0) return [];
  const k = Math.max(1, Math.min(maxRows, blocks.length));
  const masses = blocks.map((b) => blockMass(b.text));
  const total = masses.reduce((a, b) => a + b, 0);
  const target = total / k;

  const sections: DocSection[] = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    acc += masses[i]!;
    const remainingBlocks = blocks.length - i - 1;
    const remainingSections = k - sections.length - 1;
    // Close when the budget is met (and later sections remain to open), when
    // the leftover blocks are only just enough to give every remaining
    // section one block, or at the end of the document.
    const budgetMet = acc >= target && sections.length < k - 1;
    const mustClose = remainingBlocks <= remainingSections;
    if (budgetMet || mustClose || i === blocks.length - 1) {
      sections.push({
        index: sections.length,
        blockIds: blocks.slice(start, i + 1).map((b) => b.blockId),
        label: labelFor(blocks, start, i),
        mass: acc,
      });
      start = i + 1;
      acc = 0;
    }
  }
  return sections;
}

/** blockId → section index, for mapping placements onto rows. */
export function buildSectionIndex(sections: DocSection[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const section of sections) {
    for (const id of section.blockIds) index.set(id, section.index);
  }
  return index;
}
