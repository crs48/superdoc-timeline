# SuperDoc Timeline

Upload a Word document, get a shareable link, edit it live with anyone who has the link — and
watch **who contributed what, when** in an area chart under the editor.

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

5. **"Edit volume" means grouped edit bursts, not characters.** Activity entries carry a time
   span, not a size. With `group=true&groupMaxGap=5000`, continuous typing is one burst and a real
   pause starts a new one. The axis is labeled honestly ("bursts"). Character-accurate volume via
   `delta=true` is an isolated upgrade in `normalize.ts` — everything downstream treats `weight`
   as opaque.

6. **Open auth, and exactly what that exposes.** `getAccessType()` returns `'rw'` for everyone —
   the brief specifies public shareable URLs with no permission model. Consequence worth naming:
   `DELETE /api/ydoc/v1/...` and `POST /api/rollback/v1/...` are also unauthenticated, so anyone
   with a room URL can destroy or rewind that document with `curl`. Acceptable for unguessable
   `nanoid(12)` demo rooms; the first thing to fix in anything real.

7. **HashRouter** (`#/d/:roomId`) because GitHub Pages has no rewrite rules — deep links work with
   zero deploy configuration, at the cost of a `#` in the URL.

8. **No `@superdoc-dev/react`.** Its `latest` targets SuperDoc v1 and its v2 prerelease pins
   `superdoc` to an exact `-next` version. The vanilla mount in a `useEffect` is what SuperDoc's
   own React guide does anyway.

9. **SuperDoc's Web Workers are self-hosted.** Under pnpm, SuperDoc resolves its three worker
   bundles to a virtual-store path Vite won't serve. `scripts/copy-superdoc-workers.mjs` copies
   them into `public/superdoc-workers/` and the app passes explicit `workerUrls` — which also
   pins them under the Pages base path in production.

10. **No React StrictMode.** Its dev-only double-invoked effects destroy the first SuperDoc
    instance mid-boot, after which the second cannot open the room (it hangs before the WebSocket
    with no exception). One live editor instance per mount is a v2 runtime requirement.

11. **`BlankDOCX` must be typed.** A cold joiner has no file, so they seed from SuperDoc's
    exported blank document — but the raw data-URL fetch yields `application/octet-stream`, which
    stalls the v2 collaboration engine silently. Wrapping the bytes in a
    `File` with the DOCX MIME type fixes it ([src/components/EditorPane.tsx](src/components/EditorPane.tsx)).

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

AI edit summarization · timeline scrubbing / document rewind · rooms, permissions, accounts ·
section-aware chunking · visual polish · tests beyond the bucketing logic (the only non-trivial
pure logic in the app).

## With more time

- Character-accurate volume via the activity API's `delta=true`
- Real JWT auth so rollback/delete are not public
- Push (y/hub webhooks or a WS side-channel) instead of 5s polling
- Section attribution via the changeset API
- Per-contributor filtering and brush-to-zoom on the chart
- An upstream issue for the `sd2/v2.1` path mismatch so the shim can be deleted

## Licensing

`server/` derives from [yjs/yhub](https://github.com/yjs/yhub) (AGPL-3.0); the modifications are
published here in accordance with that license. The frontend is unencumbered.
