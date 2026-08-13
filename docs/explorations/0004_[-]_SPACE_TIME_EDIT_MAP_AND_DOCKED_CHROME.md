---
title: Space-Time Edit Map & Docked Chrome
status: draft
last_updated: 2026-08-13
review: 2026-08-20 # same one-week take-home window as 0002/0003: ship or moot
decider: Chris Smothers
door: two-way
tags: [superdoc, timeline, dataviz, ux, layout, yhub]
---

# Space-Time Edit Map & Docked Chrome

> [!TIP]
> **TL;DR** — Replace the default chart with a <mark>space-time edit map</mark>: document
> position on the y-axis (one row per block, weighted by length), **gap-compressed** time on the
> x-axis (idle stretches cut, marked with a thin seam, so the chart always fills the full width),
> and one rectangle per <mark>episode</mark> — consecutive bursts by the same author in the same
> block, folded together across pauses. The placement data comes from generalizing 0003's
> reconstruct-and-diff pipeline from "on hover" to "for every burst" (cached, incremental).
> This is IBM's *history flow* adapted from ownership to activity, and its authors shipped the
> same real-time-vs-compressed spacing toggle two decades ago. Independently and first: rebuild
> `RoomView` as fixed chrome — sticky header, History-Mode banner lifted into the shell, and the
> chart as an always-visible bottom dock with collapse + drag-resize. The existing stacked-area
> chart survives as a secondary "Volume" tab, keeping M4's brush and summary intact.

## Problem Statement

Three complaints about the shipped timeline, all real:

1. **Chunking is time-blind.** y/hub groups changes into bursts by a 5-second pause
   (`groupMaxGap=5000`). Write a paragraph slowly, thinking between sentences, and the chart
   shows eight disconnected blips instead of one act of writing. The unit the human cares about —
   *"I edited this block of text"* — spans pauses. Time-gap grouping can never see it; only
   **where** the edits landed can.
2. **The chart says who and when, never where.** Two contributors editing the same paragraph in
   turns and two contributors writing separate sections look identical. The vertical axis
   currently spends itself on burst counts; it could be spending itself on **document space**.
3. **The presentation wastes screen.** Idle stretches occupy horizontal space proportional to
   wall-clock time ("dead air"), while the chart itself lives below the document — below the
   fold on any real document — and every header scrolls away with the page.

## Executive Summary

The three complaints share one answer split across two independent tracks:

- **Track A — chrome (pure CSS/layout, zero data risk).** `RoomView` becomes a fixed
  `h-dvh` shell: header row(s) pinned on top, document scrolling in the middle, and the timeline
  as a persistent bottom **dock** — collapsible, drag-resizable, state persisted. History Mode's
  banner moves out of the editor overlay into the chrome stack. Ship this first; it improves the
  product even if Track B never lands.
- **Track B — the map (data + a ~200-line custom SVG).** The 0003 exploration proved every
  burst's location is recoverable (`changeset` reconstruction → blockId-keyed diff) and verified
  it against live rooms. Run that pipeline for *all* bursts (cached, newest-first, incremental)
  to build a **placement index**; fold bursts into **episodes** (same author + same block, pauses
  ignored); sessionize time and cut the gaps; render episode rectangles on a blocks × sessions
  plane, colored by contributor. Recharts cannot draw any of this (discontinuous scales,
  per-row rects), and the data volumes are tiny — a hand-rolled SVG component with a
  piecewise-linear time scale is smaller than the workarounds.

The two tracks meet at the dock: `[Map | Volume]` tabs, Map default, Volume keeping the shipped
brush + summary. Map marks are also the natural trigger surface for 0003's hover spotlight —
one mark *is* one episode, no bucket ambiguity.

---

## Current State In The Repository

Post-merge of `main` (PR #2: M4 interactivity, M5 snapshot fetch, M6 History Mode all shipped).

| Piece | Status | Where | Bearing on this work |
| --- | --- | --- | --- |
| Burst grouping | ✅ Shipped, server-side | [fetchActivity](../../src/collab/yhub.ts) (`group=true&groupMaxGap=5000`) | Stays the atom; episodes are a client-side fold **over** bursts, not a fetch change |
| Buckets + stacked area | ✅ Shipped | [bucket.ts](../../src/contributions/bucket.ts), [ContributionChart.tsx](../../src/components/ContributionChart.tsx) | Becomes the "Volume" tab unchanged |
| Brush + summary + legend solo | ✅ Shipped (M4) | [EditsPanel.tsx](../../src/components/EditsPanel.tsx), [SummaryCard.tsx](../../src/components/SummaryCard.tsx) | Volume-tab only; the map gets no brush (its x-axis is already compressed) |
| Point-in-time reconstruction | ✅ Shipped (M5) | [fetchDocumentAt.ts](../../src/history/fetchDocumentAt.ts) | The placement index's fetch layer, as 0003 planned |
| Decoded block schema | ✅ Shipped (M5) | `extractParagraphs` ibid. | Extend to keep `blockId` (0003's `extractBlockTexts`) |
| History Mode | ✅ Shipped (M6) | [HistoryPreview.tsx](../../src/components/HistoryPreview.tsx), `historyAt` in [store/room.ts](../../src/store/room.ts) | Banner lifts into chrome; map click must map compressed-x → real `t` |
| Hover spotlight | 📄 Explored, not started | [0003](0003_%5B_%5D_TIMELINE_HOVER_EDIT_SPOTLIGHT.md) | Its P1 diff service **is** the placement index minus prefetch — build once, share |
| Page layout | ⚠️ Scrolls | [RoomView.tsx](../../src/components/RoomView.tsx) (`min-h-screen`), [ShareBar.tsx](../../src/components/ShareBar.tsx) | `min-h-screen` lets the panel fall below the fold; nothing is sticky |

> [!IMPORTANT]
> The load-bearing dependency: **0003's placement pipeline is assumed and generalized.** 0003
> computes `{ blockId, offset, inserted, deleted }` for one hovered burst; this exploration runs
> the same pure functions over every burst and memoizes. If 0003's P0 probe fails for the live
> editor, the *map is unaffected* — placement only needs y/hub reconstructions, which are already
> verified. Only the spotlight integration degrades.

## External Research

- **History flow** ([Viégas & Wattenberg, IBM](http://hint.fm/projects/historyflow/); [CHI 2004
  paper](https://dl.acm.org/doi/10.1145/985692.985765)) — *the* prior art: x = revision/time,
  y = document space, color = author, famously applied to Wikipedia's *chocolate* article. Two
  details transfer directly: (1) they shipped **both** spacing modes — proportional to real time
  and one-column-per-revision — because each answers different questions; (2) their y-axis is
  *document composition* (every character colored by current owner), which is gorgeous but
  requires attributing every character of every version. Our activity-mark variant (color only
  what changed) needs one diff per burst instead of a full ownership walk — the affordable 80%.
- **Etherpad's timeslider** — authorship colors + a scrubbable timeline; validates
  author-color-in-document-space as instantly legible collaboration UX.
- **Discontinuous time scales in finance** ([d3fc-discontinuous-scale](https://github.com/d3fc/d3fc/tree/master/packages/d3fc-discontinuous-scale),
  [weekend-skipping example](https://gist.github.com/ColinEberhardt/0a5cc7ca6c256dcd6ef1e2e7ffa468d4)) —
  cutting no-data intervals out of a time axis is a solved, conventional pattern (markets close;
  nobody plots the night). The API shape (`clampUp/clampDown/distance/offset`) is exactly the
  piecewise mapping the map needs; at our scale a ~40-line hand-rolled version beats the
  dependency, but it validates the design and its known gotcha (ticks inside a cut clamp to the
  boundary — so ticks must be session-edge-aware).
- **Narrative ("storyline") charts** — xkcd-657-style layouts confirm the readability of
  entity-colored bands over a time × position plane, and also warn: full storyline layout
  optimization is NP-hard territory. Fixed rows (blocks don't move) sidestep all of it.
- **Recharts** — no discontinuous scales, no per-cell rect series; issues on non-linear axes
  have sat open for years (the M4 Brush saga was the warning shot). Custom SVG in React is the
  norm for this shape of chart.

## Key Findings

1. **"Contiguous edit" is a spatial predicate, and space is already computable.** The episode
   the user describes — same author, same paragraph, pauses irrelevant — cannot be derived from
   timestamps alone at any `groupMaxGap`. With per-burst `blockId`s from the 0003 pipeline it is
   a ten-line fold. Chunking quality stops being a tuning knob and becomes a definition.
2. **The placement index is the expensive-looking, actually-cheap part.** One cached
   reconstruction per burst *boundary* (~N+1 fetches for N bursts, each the full doc state —
   ~12 KB at demo scale, shared with History Mode's cache), computed newest-first so the visible
   recent history populates immediately, then incremental per poll: only new bursts fetch.
   History never changes, so the cache never invalidates. $O(N)$ once, $O(\Delta)$ forever.
3. **Gap compression and "always fill the width" are the same feature.** Sessionize activity
   (gap > threshold ⇒ cut), allocate width per session proportional to its *active* duration
   with a floor, render cuts as fixed-width hatched seams: the axis fills 100% width by
   construction, with an explicit piecewise-linear `x(t)` both ways — which History Mode clicks
   and hover tooltips need anyway. $w_i = w_{\min} + \left(W - n\,w_{\min} - m\,w_{seam}\right)\frac{d_i}{\sum d_j}$.
4. **Rows should be blocks, weighted by length.** A row per `blockId` (document order, height ∝
   current text length, clamped) makes the y-axis a recognizable minimap of the document —
   "the intro", "that big middle section". Uniform rows are the fallback for degenerate cases.
   Since-deleted blocks fold into a single "removed content" row rather than vanishing.
5. **The chrome is independent and strictly positive.** `h-dvh` shell, `min-h-0` on the scroll
   pane, dock with collapse + pointer-capture drag resize, banner lifted from `HistoryPreview`
   into the shell. No data, no SuperDoc API, no risk; ship first.
6. **Keep the old chart as a tab, don't kill it.** The map answers *who/where/when*; the stacked
   area answers *how much*; M4's brush/summary live there. Tabs cost one `useState`.

---

## Options And Tradeoffs

### The visualization

| Option | Answers "where"? | Fixes chunking? | Fills width? | Build cost | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Space-time edit map** — episode rects on blocks × compressed sessions | ✅ | ✅ episodes | ✅ by construction | ~1.5–2 h on top of placement index | ✅ **Recommended** |
| B. Heatmap raster — time bins × block rows, intensity cells | ✅ coarse | ❌ re-fragments at bin edges | ✅ | ~1 h | 🚧 Fallback if A's layout fights back |
| C. Full history flow — per-character ownership ribbons | ✅✅ | ✅ | ✅ | Ownership walk over *every* version; interpolation | 🛑 Rejected for now — the beautiful 120% (future toggle) |
| D. Author swimlanes — gantt bars per contributor, no space axis | ❌ | ✅ | ✅ | ~1 h | 🛑 Rejected — half the ask |
| E. Bend recharts (jittered scatter / annotation hacks) | ⚠️ fake | ❌ | ❌ no discontinuous scale | Endless | 🛑 Rejected — M4's Brush lesson, squared |

### The time axis, within A

| Mode | Precedent | Property | Call |
| --- | --- | --- | --- |
| **Sessions, width ∝ active duration, cuts as seams** | Trading-hours axes | Durations within a session stay honest; idle time visibly *marked* but not *spent* | ✅ Default |
| One column per burst (ordinal) | History flow's "by revision" spacing | Maximum density; all duration information lost | 🚧 Cheap secondary toggle if wanted |
| True linear time | Today's chart | Honest and mostly empty | Available in the Volume tab |

### The chrome

No real options here — fixed shell + bottom dock is the only design that satisfies "always
visible, expandable, draggable". The one decision: **CSS grid/flex with our own drag handle**
(recommended; ~30 lines, no dependency) vs a split-pane library (overkill for one axis).

---

## Recommendation

Two tracks, chrome first.

```mermaid
flowchart LR
    subgraph Track A — chrome
      A1["h-dvh shell<br/>sticky header"] --> A2["bottom dock<br/>collapse + drag"] --> A3["banner lifted<br/>into chrome"]
    end
    subgraph Track B — map
      B1["placement index<br/>(0003 P1, all bursts)"] --> B2["episode fold"] --> B3["sessionize +<br/>piecewise x(t)"] --> B4["SVG map<br/>+ tabs"]
    end
    A2 --> B4
    B4 --> I["integrations:<br/>history click · 0003 spotlight hover"]
    style A1 fill:#238636,stroke:#2ea043,color:#fff
    style B4 fill:#1f6feb,stroke:#388bfd,color:#fff
```

### The dock, concretely

```text
┌──────────────────────────────────────────────────────────────┐
│ ShareBar (sticky)                                            │ ← chrome
│ [History Mode banner — only when historyAt != null] (sticky) │ ← chrome
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   document scrolls here (overflow-auto, min-h-0)             │
│                                                              │
├══════════ drag handle (8px, cursor-row-resize) ══════════════┤
│ Dock header: "Edits" · [Map|Volume] · legend · ⌄ collapse    │ ← chrome
│ ┌─────────┬──────────────┬───┬──────────────────────┐        │
│ │ intro   │ ▓▓Alice▓▓    │ ⋮ │                      │        │  rows =
│ │ middle  │      ▓Bob▓▓▓ │ ⋮ │ ▓▓▓Alice▓▓▓          │        │  blocks
│ │ outro   │              │ ⋮ │        ▓Bob▓         │        │  (len-
│ │ removed │              │ ⋮ │                      │        │  weighted)
│ └─────────┴──────────────┴───┴──────────────────────┘        │
│   session 1 (14:02–14:11)  cut   session 2 (16:40–16:55)     │
└──────────────────────────────────────────────────────────────┘
```

Hatched `⋮` seams carry a tooltip ("2 h 29 m idle"). Hovering an episode rect shows author,
time span, ± characters — and, once 0003 lands, scrolls the document to the block (the map
replaces 0003's bucket-hover ambiguity with an exact episode). Clicking anywhere sets
`historyAt` via the inverse piecewise mapping, exactly as the area chart does today.

### Definitions that do the heavy lifting

- **Episode:** maximal run of bursts, same `contributorId`, consecutive in that contributor's
  burst sequence, with intersecting touched-block sets, and gap between consecutive bursts
  ≤ `EPISODE_MAX_GAP` (default 15 min — a lunch break ends an episode even in the same block).
- **Session:** maximal time range where the gap between consecutive episodes (any author)
  ≤ `SESSION_GAP` (default 5 min). Everything between sessions is a **cut**.
- Both constants live beside the fold functions, unit-tested, and are honest UI copy
  ("gaps over 5 min are collapsed").

## Example Code

### Placement index (generalizes 0003's diff service; pure + store)

```ts
// src/spotlight/placementIndex.ts
import type { BurstChange } from './burstDiff';
import { diffForBurst } from './burstDiff'; // 0003 P1, LRU inside

export interface BurstPlacement {
  burstId: string;
  changes: BurstChange[]; // [] = fetched, no text change (formatting-only)
}

/**
 * Fill placements for bursts we haven't located yet, newest first so the
 * visible recent history lights up immediately. Two in flight, cache does the
 * rest — history is immutable, so a placement never needs refetching.
 */
export async function fillPlacements(
  roomId: string,
  bursts: ContributionEvent[],
  have: ReadonlyMap<string, BurstPlacement>,
  put: (p: BurstPlacement) => void,
  signal?: AbortSignal,
) {
  const missing = bursts.filter((b) => !have.has(b.id)).sort((a, b) => b.endedAt - a.endedAt);
  const pool = missing[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (const burst of pool) {
        if (signal?.aborted) return;
        const { changes } = await diffForBurst(roomId, burst, signal);
        put({ burstId: burst.id, changes });
      }
    }),
  );
}
```

### Episode fold + sessionization (pure, unit-testable)

```ts
// src/contributions/episodes.ts
export interface EditEpisode {
  contributorId: ContributorId;
  blockIds: ReadonlySet<string>;
  startedAt: number;
  endedAt: number;
  weight: number; // Σ burst weights
}

const EPISODE_MAX_GAP = 15 * 60_000;

export function foldEpisodes(
  bursts: ContributionEvent[], // sorted by startedAt
  placementOf: (id: string) => BurstPlacement | undefined,
): EditEpisode[] {
  const open = new Map<ContributorId, EditEpisode & { blocks: Set<string> }>();
  const out: EditEpisode[] = [];
  for (const b of bursts) {
    const blocks = new Set(placementOf(b.id)?.changes.map((c) => c.blockId) ?? []);
    const cur = open.get(b.contributorId);
    const continues =
      cur &&
      b.startedAt - cur.endedAt <= EPISODE_MAX_GAP &&
      (blocks.size === 0 || [...blocks].some((id) => cur.blocks.has(id)));
    if (cur && continues) {
      cur.endedAt = Math.max(cur.endedAt, b.endedAt);
      cur.weight += b.weight;
      for (const id of blocks) cur.blocks.add(id);
    } else {
      if (cur) out.push(finish(cur));
      open.set(b.contributorId, start(b, blocks));
    }
  }
  for (const cur of open.values()) out.push(finish(cur));
  return out.sort((a, b) => a.startedAt - b.startedAt);
}
```

```ts
// src/contributions/sessions.ts — the compressed axis both ways
export interface TimeSegment {
  t0: number; t1: number;   // real time
  x0: number; x1: number;   // [0,1] compressed
  kind: 'session' | 'cut';
}

export function xOf(t: number, segs: TimeSegment[]): number { /* piecewise lerp; clamp into cuts' seam */ }
export function tOf(x: number, segs: TimeSegment[]): number { /* inverse; cuts map to their boundary */ }
```

### The map itself

A single `EditMap.tsx`: `<svg viewBox>` sized by `ResizeObserver`; y-layout from the latest
reconstruction's blocks (`height ∝ clamp(len, MIN, MAX)`, plus a "removed" row when any episode
references a dead blockId); episode `<rect>`s with `fill=colorForContributor(id)`,
`fillOpacity∝weight`, splitting row height when episodes overlap in time on the same block;
seams as `<pattern>` hatching; `onClick={e => setHistoryAt(tOf(x(e)))}`;
`onMouseEnter/Leave` per rect wired to the 0003 spotlight when present. No library, no
animation, `memo`ized on `(episodes, segments, blocks, size)`.

### The chrome shell

```tsx
// RoomView.tsx — the shape, not the styling
<div className="flex h-dvh flex-col overflow-hidden bg-slate-100">
  <ShareBar status={status} />                      {/* chrome */}
  {historyAt != null && <HistoryBanner … />}        {/* lifted out of HistoryPreview */}
  {error && <ErrorStrip … />}                       {/* chrome */}
  <div className="relative min-h-0 flex-1 overflow-auto">
    <EditorPane … />                                {/* the only scrolling region */}
    {historyAt != null && <HistoryPreview … />}     {/* content overlay, banner-less */}
  </div>
  <TimelineDock>                                    {/* chrome: header + tabs + body */}
    …drag handle: onPointerDown → setPointerCapture; move → setDockHeight(clamp(…, 96, 0.6*innerHeight))…
  </TimelineDock>
</div>
```

Dock height + collapsed flag persist via a small `zustand` `persist` store (same pattern as
[identity.ts](../../src/store/identity.ts)). Collapsed = header row only (~40 px), the chart
unmounts (SVG is cheap to rebuild; the placement index is the state that matters and it lives
in the store).

---

## Risks And Open Questions

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Placement backfill cost on burst-heavy rooms (N fetches of full doc state) | Slow map fill, server load | Med | Newest-first + concurrency 2 + immutable cache; cap backfill (e.g. last 500 bursts) and label older history "volume only" |
| R2 | Formatting-only / atom edits place nowhere (`changes: []`) | Episodes invisible on map | Med | Render as thin full-width ticks in an "unplaced" gutter so activity is never silently dropped |
| R3 | Block splits/merges break episode continuity (`blockId` changes) | One act of writing → two episodes | Med | Schema carries `splitFromBlockId`/`mergedIntoBlockId` (0003 probe) — treat lineage ids as the same row/key |
| R4 | Row layout degenerates (1-block doc, or 200-block doc in a 160 px dock) | Unreadable map | Med | Clamp row heights; overflow to proportional-no-labels mode; the dock is resizable by design |
| R5 | Compressed axis vs. Brush/summary expectations | Confusion | Low | Brush stays in the Volume tab only; the map's seams + session labels make the compression explicit |
| R6 | Drag-resize jank with SuperDoc relayout on every pixel | Choppy drag | Med | Resize a wrapper (editor pane is `flex-1`; only final height commits), `requestAnimationFrame` throttle |
| R7 | `h-dvh` on iOS Safari / small screens | Chrome eats the document | Low | `dvh` (not `vh`) is the fix, dock defaults collapsed under 768 px — matching the existing narrow-viewport care (V13) |
| R8 | Two sources of truth for "grouping" (server bursts, client episodes) | Metric drift between tabs | Low | Episodes only ever *aggregate* bursts; totals reconcile by construction; unit test asserts Σ weights equal |

### Open questions

- [ ] `SESSION_GAP` and `EPISODE_MAX_GAP` defaults — 5 min / 15 min are guesses; check feel
      against a real two-person session before hardcoding copy.
- [ ] Overlapping episodes on one block (true simultaneous co-editing): split row height (flat)
      or nested rects? Decide from real data; V16's interleaving test room is the fixture.
- [ ] Does the map need an in-map "now" affordance (right edge pulse) so live rooms read as
      live? Cheap; decide by demo feel.
- [ ] Ownership-mode toggle (Option C, per-char attribution walk) — leave as the README
      "with more time" flagship or attempt after everything above ships?

## Implementation Checklist

**Status:** `░░░░░░░░░░ 0/16 items`

### Track A — chrome (~1 h, ship first, zero data risk)
- [x] `RoomView` → `h-dvh flex flex-col overflow-hidden`; editor pane `min-h-0 flex-1 overflow-auto`
- [x] Lift the History-Mode banner out of `HistoryPreview` into a chrome `HistoryBanner`
- [x] `TimelineDock`: header row (title · tabs placeholder · legend · collapse chevron), body
      hosting the existing `EditsPanel` content
- [x] Drag handle: pointer capture, clamp `[96, 0.6 × innerHeight]`, rAF-throttled
- [x] Persist `{ height, collapsed }` (zustand `persist`); default collapsed < 768 px
- [x] Verify V13 (narrow viewport) still passes with the dock

### Track B0 — placement index (~1 h)
- [x] Land 0003's `burstDiff.ts` (or extract if 0003 already merged) + `placementIndex.ts`
      with newest-first backfill, concurrency 2, abort on room change
- [x] Store slice keyed by burst id; incremental fill on each poll

### Track B1 — folds (~45 min, pure + tests)
- [x] `episodes.ts` fold with block-lineage keys (R3) + unit tests (pause-in-same-block merges;
      author interleave splits; Σ weight reconciliation for R8)
- [x] `sessions.ts` segments + `xOf`/`tOf` + unit tests (round-trip, cut clamping)

### Track B2 — the map (~1.5 h)
- [x] `EditMap.tsx`: block rows (length-weighted, clamped), episode rects, seams, session
      labels, unplaced-activity gutter (R2), removed-content row
- [x] `[Map | Volume]` tabs in the dock; Volume = existing chart + brush + summary untouched
- [x] Map click → `tOf(x)` → `setHistoryAt` (M6 parity)

### Integration & ship gate
- [x] Hover episode → 0003 spotlight when implemented (guard: no-op otherwise)
- [x] README: new decision rows (episodes vs bursts; gap compression; custom SVG over recharts;
      dock chrome) 
- [x] Check off this exploration (`[-]` at Track A alone is legitimate)

**Cut order:** ownership toggle (never started) → spotlight integration → unplaced gutter →
length-weighted rows (uniform fallback) → Volume tab tabs-polish → **never cut Track A**.

## Validation Checklist

- [x] **V1** Type a paragraph with 10–20 s pauses between sentences → **one** episode rect on
      the map (today: many bursts), while the Volume tab still shows the honest bursts
- [ ] **V2** Two contributors editing different sections → visibly separate rows light up in
      each author's color; same section in turns → same row, alternating colors
- [x] **V3** Edit, wait > `SESSION_GAP`, edit again → two sessions with a hatched seam; chart
      spans full dock width; seam tooltip shows the elapsed gap
- [x] **V4** Map click inside a session → History Mode opens at that real timestamp; click a
      seam → boundary timestamp, no crash
- [x] **V5** Dock: collapse to header, expand, drag between clamps; height survives reload;
      document never hides behind the dock (no content under chrome)
- [x] **V6** History Mode: banner visible in chrome while the preview overlays the editor;
      dock and header never scroll away
- [x] **V7** Backfill: opening a room with existing history fills newest sessions first;
      network shows ≤ 2 concurrent changeset fetches; reopening the room refetches nothing
- [ ] **V8** Formatting-only edit (bold a word) → appears in the unplaced gutter, not dropped
- [x] **V9** `pnpm test` — episodes, sessions, placement reconciliation suites green
- [x] **V10** 320 px viewport: dock defaults collapsed; expanded map scrolls/clamps legibly

## References

**This repository**
- [0003 — Timeline Hover → Edit Spotlight](0003_%5B_%5D_TIMELINE_HOVER_EDIT_SPOTLIGHT.md) — the
  placement pipeline this generalizes; the live-room probes grounding it
- [0002 — Milestone Build Plan](0002_%5B-%5D_MILESTONE_BUILD_PLAN.md) — M4 Brush lessons, M5
  changeset verification, M6 overlay rule
- [src/contributions/bucket.ts](../../src/contributions/bucket.ts) — the time-only bucketing the
  map complements
- [src/history/fetchDocumentAt.ts](../../src/history/fetchDocumentAt.ts) — reconstruction + schema walk

**Prior art**
- [History flow — Viégas & Wattenberg](http://hint.fm/projects/historyflow/) ·
  [CHI 2004 paper](https://dl.acm.org/doi/10.1145/985692.985765) ·
  [IBM History Flow tool (Wikipedia)](https://en.wikipedia.org/wiki/IBM_History_Flow_tool)
- [d3fc-discontinuous-scale](https://github.com/d3fc/d3fc/tree/master/packages/d3fc-discontinuous-scale) ·
  [weekend-skipping discontinuous axis example](https://gist.github.com/ColinEberhardt/0a5cc7ca6c256dcd6ef1e2e7ffa468d4)
- Etherpad timeslider — authorship colors over a scrubbable document timeline
