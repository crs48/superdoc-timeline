# SuperDoc Timeline

Upload a Word document, get a shareable link, edit it live with anyone who has the link — and
watch **who contributed what, when, and where** in a timeline docked under the editor. The
default **Map** view is an organic edit terrain: document sections on the y-axis (as many rows
as fit the dock, never more), gap-compressed elastic time on the x-axis (idle gaps collapse to
seams; dense history grows the chart and scrolls, pinned to the live edge), and one smooth
kernel-density lobe per burst — contributor-colored, translucent, multiply-blended where
authors overlap. The **Volume** tab keeps the stacked area chart with a brush window,
per-contributor totals, and legend solo. Click either chart to enter **History Mode**: the
document as it was at that moment, reconstructed by the server, with a one-click return to
live.

Built as a ~4-hour take-home. The full design rationale, including the dead ends, lives in
[docs/explorations/0001](docs/explorations/0001_%5Bx%5D_SUPERDOC_CONTRIBUTIONS_TIMELINE.md), and the
plan for what remains in
[docs/explorations/0002](docs/explorations/0002_%5B-%5D_MILESTONE_BUILD_PLAN.md).

## Architecture

```text
┌────────────────────────────┐         ┌─────────────────────────────────────────┐
│  GitHub Pages (static)     │         │  Railway — one container, one volume    │
│                            │  wss    │  ┌───────────────┐   ┌───────────────┐  │
│  React + Vite + TS         │ ──────▶ │  │ ws-path-shim  │──▶│ y/hub (patched│  │
│  SuperDoc v2 (Web Workers) │         │  │ (public PORT) │   │ auth) :3002   │  │
│  Zustand · Recharts        │  https  │  └───────────────┘   │ + Postgres 16 │  │
│  #/d/:roomId               │ ──────▶ │        │             │ + Valkey      │  │
└────────────────────────────┘         │        └── /data ────┴───────────────┘  │
                                       └─────────────────────────────────────────┘
```

Two deliberately independent channels:

- **Document channel** — SuperDoc v2 owns the `Y.Doc` and its y-websocket provider inside a Web
  Worker. We hand it a server URL and never touch the socket.
- **Attribution channel** — the Edits Panel polls y/hub's REST
  [Activity API](https://github.com/yjs/yhub/blob/master/API.md) (`GET /api/activity/v1/...`)
  every 5s. If it fails, the chart degrades and the document keeps working.

## Key decisions & trade-offs

1. **The chart reads y/hub's Activity API, not client-side Yjs taps.** SuperDoc v2 removed the v1
   `modules.collaboration: { ydoc, provider }` contract and runs its `Y.Doc` inside an obfuscated
   Web Worker — there is no supported main-thread update tap, and the public `onEditorUpdate`
   event carries no author, delta, or size. y/hub already records per-user, timestamped edit
   activity server-side and serves it over CORS-open REST. Reading it is both less code and a
   stronger claim (server-observed, not client-asserted), and late joiners get full history free.

2. **The ws-path-shim exists because SuperDoc and y/hub disagree about URLs.** SuperDoc v2's
   y-websocket client does not connect to `${serverUrl}/${documentId}` — it requests
   `/api/ws/v1/{org}/sd2/v2.1/{documentId}`. y/hub addresses a room by exactly two path segments
   and silently drops the upgrade otherwise; SuperDoc then reports `COLLAB_V2_SYNC_TIMEOUT`. A
   vanilla `yjs` + `y-websocket` client syncs against y/hub perfectly, so this is purely a
   path-shape mismatch. [server/ws-path-shim.mjs](server/ws-path-shim.mjs) collapses the extra
   segments (`sd2/v2.1/room` → `sd2__v2.1__room`); the client queries the activity API with the
   same collapsed id ([src/collab/yhub.ts](src/collab/yhub.ts) mirrors the rule).

3. **The y/hub image is patched because stock attribution is decorative.** The standalone image
   assigns every connection a random user id from
   `['Calvin Hobbes', 'Charlie Brown', 'Dilbert Adams', 'Garfield']`.
   [server/yhub.js](server/yhub.js) records the `yauth` query parameter instead, which SuperDoc
   forwards via `v2Collaboration.params` — so `activity[].by` is the client's stable deviceId.

4. **Identity is an unverified `deviceId`, by design.** There are no accounts, so "user" doesn't
   exist — a device does. `crypto.randomUUID()` persisted in localStorage becomes y/hub's user id;
   the display name travels separately as a custom attribution (`name:Alice`) so renames don't
   fork identity. Spoofable, yes — and irrelevant, because there is nothing to escalate to.

5. **"Edit volume" means grouped edit bursts — and the character upgrade was built, measured, and
   deliberately reverted.** The activity API's `delta=true` returns each burst's ops, and
   `weightOf()` in [src/contributions/normalize.ts](src/contributions/normalize.ts) counts only
   ops carrying an `attribution` (the delta also echoes unattributed context ops; summing
   everything measured 2100 "naive" chars against a real 100+100 in a two-writer probe). Verified
   exact against plain-Yjs text rooms — and then discovered that y/hub renders a *SuperDoc v2*
   room's delta as its content-unit metadata map: the typed text never appears, so for real
   traffic the flag costs ~3KB per entry and every burst degrades to 1 anyway. The axis therefore
   says "bursts", which is what the data can honestly support; the tested delta walk stays in the
   code as the upgrade path if y/hub learns to unfold SuperDoc content units.

6. **Open auth, and exactly what that exposes.** `getAccessType()` returns `'rw'` for everyone —
   the brief specifies public shareable URLs with no permission model. Consequence worth naming:
   `DELETE /api/ydoc/v1/...` and `POST /api/rollback/v1/...` are also unauthenticated, so anyone
   with a room URL can destroy or rewind that document with `curl`. Subtler: any plain Yjs client
   that writes *any* root into a SuperDoc room permanently bricks it — v2 refuses to reopen the
   room with "conflicting room formats" (verified live; five lines of `y-websocket` suffice).
   Acceptable for unguessable `nanoid(12)` demo rooms; the first thing to fix in anything real.

7. **HashRouter** (`#/d/:roomId`) because GitHub Pages has no rewrite rules — deep links work with
   zero deploy configuration, at the cost of a `#` in the URL.

8. **No `@superdoc-dev/react`.** Its `latest` targets SuperDoc v1 and its v2 prerelease pins
   `superdoc` to an exact `-next` version. The vanilla mount in a `useEffect` is what SuperDoc's
   own React guide does anyway.

9. **SuperDoc's Web Workers are self-hosted.** Under pnpm, SuperDoc resolves its three worker
   bundles to a virtual-store path Vite won't serve. `scripts/copy-superdoc-workers.mjs` copies
   them into `public/superdoc-workers/` and the app passes explicit `workerUrls` — which also
   pins them under the Pages base path in production.

10. **No component library.** The planned shadcn/ui was dropped mid-build: this UI needs five
    components, raw Tailwind utilities carry them fine, and a generated `components/ui/` tree
    would have been scaffolding for a reviewer to wade through. Scope decision, not an oversight.

11. **No React StrictMode.** Its dev-only double-invoked effects destroy the first SuperDoc
    instance mid-boot, after which the second cannot open the room (it hangs before the WebSocket
    with no exception). One live editor instance per mount is a v2 runtime requirement.

12. **History Mode is a query, not a feature.** y/hub's changeset API returns the room's Yjs
    update "as it was at `to`" — the backend already stores every version, so time travel is
    `GET /api/changeset/v1/...?to=<ts>&ydoc=true` plus `Y.applyUpdate` on a throwaway doc
    ([src/history/fetchDocumentAt.ts](src/history/fetchDocumentAt.ts)). There is deliberately no
    client-side snapshot store — that would make the client a second system of record. The preview
    is text-level (SuperDoc's Y.Doc schema was discovered at runtime: `content` → story shards →
    `blocks[]` → `text`; formatting is intentionally not replayed), rendered as an overlay so the
    live editor and its socket stay mounted underneath. One Yjs trap worth naming: reading an
    untyped root with the wrong accessor silently re-types it — type only the roots you know.

13. **`BlankDOCX` must be typed.** A cold joiner has no file, so they seed from SuperDoc's
    exported blank document — but the raw data-URL fetch yields `application/octet-stream`, which
    stalls the v2 collaboration engine silently. Wrapping the bytes in a
    `File` with the DOCX MIME type fixes it ([src/components/EditorPane.tsx](src/components/EditorPane.tsx)).

14. **Episodes are a spatial fold over bursts, not a bigger time threshold.** "I edited this
    paragraph, thinking between sentences" is invisible to any pause-based grouping. Instead,
    every burst is *located*: the document just before and at the end of the burst are
    reconstructed from the changeset API and diffed per native `blockId`
    ([src/spotlight/burstDiff.ts](src/spotlight/burstDiff.ts) — one immutable, cached fetch per
    burst boundary, backfilled newest-first at concurrency 2). Same author + same block folds
    into one episode regardless of pauses ([src/contributions/episodes.ts](src/contributions/episodes.ts)).
    Lineage is deliberately two different relations: ancestry roots keep an episode together
    across a paragraph split, while display rows stay one-per-live-block — full canonicalization
    would collapse an organically grown document onto its seed paragraph. Episode weights always
    sum to burst weights, so the two tabs can never disagree about totals.

15. **The Map's time axis cuts dead air.** Activity is grouped into sessions (gaps over 5 min
    collapse to a fixed hatched seam) and session widths are proportional to active duration on
    top of a floor, so the chart always fills its full width
    ([src/contributions/sessions.ts](src/contributions/sessions.ts)). The same pattern financial
    charts use to skip non-trading hours; the piecewise mapping is exact both ways, which is what
    lets a click on compressed pixels land History Mode on a real timestamp.

16. **The Map is hand-rolled SVG, not recharts — and its paint is math, not filters.** Recharts
    has neither discontinuous time scales nor kernel-density series, and its `Brush` already
    taught this repo what fighting the library costs (see the uncontrolled-brush note in 0002).
    The organic look is four cheap ingredients: a raised-cosine kernel per burst (pauses show
    as dips, same-author bursts fuse), Catmull-Rom smoothing, translucent fills under
    `mix-blend-mode: multiply` (overlapping authors genuinely mix color), and joyplot-style row
    overflow ([src/components/terrain.ts](src/components/terrain.ts)). The SVG "gooey" filter
    was evaluated and rejected: its alpha-contrast trick degrades to plain blur in
    Safari/Firefox. Episode rectangles survive as a transparent hit layer, so tooltips and
    click-to-history are exact even though the paint is soft.

17. **The timeline is chrome, not content.** `RoomView` is a fixed `h-dvh` shell: header and
    History-Mode banner pinned on top, the document as the only scrolling region, and the
    timeline in an always-visible bottom dock — collapsible, drag-resizable (pointer capture,
    rAF-throttled), height persisted per profile, defaulting collapsed under 768px
    ([src/components/TimelineDock.tsx](src/components/TimelineDock.tsx),
    [src/store/dock.ts](src/store/dock.ts)).

18. **Rows are measured, not data-driven; the axis is elastic, not fixed.** The map partitions
    the document into at most ⌊plotH / 36px⌋ contiguous sections balanced by text mass
    ([src/contributions/sections.ts](src/contributions/sections.ts)) — a 40-paragraph document
    in a 180px dock is 3 legible rows, and dragging the dock taller buys more. Sessions earn
    pixel budgets (24px per active minute, 10px per burst, 48px floor): short histories stretch
    to fill the dock exactly, dense ones grow past it and scroll, auto-pinned to the live edge
    until the user scrolls away ([src/contributions/sessions.ts](src/contributions/sessions.ts)).

## Run locally

Backend (Postgres + Valkey + patched y/hub in one container, plus the path shim):

```bash
docker build -f server/Dockerfile -t yhub-patched . && docker run -d -p 4403:8080 -e PORT=8080 -v yhub-data:/data yhub-patched
```

Frontend (defaults to `ws://localhost:4403`):

```bash
pnpm install && pnpm dev
```

Open `http://localhost:5273/superdoc-timeline/`, enter a name, upload a `.docx`, and open the
resulting `#/d/...` link in a second browser profile.

Tests and types:

```bash
pnpm test && pnpm typecheck
```

## How the deployed version works

- **Frontend** → GitHub Pages via [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
  One build-time variable, `VITE_YHUB_WS_URL` (a repository *variable*, not a secret — it ships
  in a public bundle).
- **Backend** → Railway builds [server/Dockerfile](server/Dockerfile) (configured by
  [railway.json](railway.json)). One service, one volume mounted at `/data` — without the volume,
  every deploy erases all documents and history. Railway's `PORT` goes to the shim; y/hub is
  pinned to `3002` inside the container.

## Intentionally left out

AI edit summarization · continuous timeline scrubbing (History Mode is click-to-jump: one request
per jump, not one per drag frame) · document rollback (the API exists; anyone can `curl` it, see
decision 6) · rooms, permissions, accounts · section-aware chunking · visual polish · tests beyond
the bucketing and normalization logic (the only non-trivial pure logic in the app).

## With more time

- Character-accurate volume, if/when y/hub can render SuperDoc content-unit deltas as text
  (the client-side walk is already written and tested; see decision 5)
- Real JWT auth so rollback/delete are not public
- Push (y/hub webhooks or a WS side-channel) instead of 5s polling
- Section attribution via the changeset API
- Rich-text rendering of History Mode (today it is a deliberate text-level preview)
- An upstream issue for the `sd2/v2.1` path mismatch so the shim can be deleted

## Licensing

`server/` derives from [yjs/yhub](https://github.com/yjs/yhub) (AGPL-3.0); the modifications are
published here in accordance with that license. The frontend is unencumbered.
