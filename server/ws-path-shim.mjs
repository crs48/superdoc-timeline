/**
 * Path shim: makes SuperDoc v2's y-websocket client addressable by y/hub.
 *
 * WHY THIS EXISTS
 * ---------------
 * y/hub identifies a room by exactly two path segments: /api/ws/v1/{org}/{docid}.
 * SuperDoc v2 does not connect to `${serverUrl}/${documentId}` as its docs imply —
 * it inserts a protocol namespace, so the upgrade it actually requests is:
 *
 *     /api/ws/v1/{org}/sd2/v2.1/{documentId}?yauth=...
 *
 * y/hub sees four segments, fails to resolve a room, and drops the upgrade with no
 * log line; SuperDoc then reports `COLLAB_V2_SYNC_TIMEOUT` after 10s. Verified: a
 * vanilla yjs@13 + y-websocket@3 client syncs against y/hub perfectly, and the same
 * URL with the extra segments removed is accepted, so this is purely a path-shape
 * mismatch and not a protocol incompatibility.
 *
 * The shim collapses every segment after {org} into a single docid, so
 *   /api/ws/v1/acme/sd2/v2.1/room123  ->  /api/ws/v1/acme/sd2__v2.1__room123
 * and forwards everything else untouched. It listens on PORT and forwards to y/hub
 * on UPSTREAM_PORT inside the same container, so this stays one Railway service.
 *
 * The client must query the REST activity API with the *collapsed* docid; see
 * `collapsedDocId()` in src/collab/yhub.ts, which mirrors this rule.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';

const PORT = Number(process.env.PORT ?? 8080);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST ?? '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 3002);
const WS_PREFIX = '/api/ws/v1/';
export const SEGMENT_JOINER = '__';

/**
 * Collapse a y/hub websocket path so that everything after {org} becomes one docid.
 * Returns the path unchanged when it is not a websocket path or already has the
 * two-segment shape y/hub expects.
 */
export function collapseWsPath(rawPath) {
  if (!rawPath.startsWith(WS_PREFIX)) return rawPath;
  const queryAt = rawPath.indexOf('?');
  const pathname = queryAt === -1 ? rawPath : rawPath.slice(0, queryAt);
  const query = queryAt === -1 ? '' : rawPath.slice(queryAt);

  const segments = pathname.slice(WS_PREFIX.length).split('/').filter(Boolean);
  if (segments.length <= 2) return rawPath;

  const [org, ...rest] = segments;
  return `${WS_PREFIX}${org}/${rest.join(SEGMENT_JOINER)}${query}`;
}

const server = createServer((req, res) => {
  // Plain HTTP (the REST activity/ydoc APIs) passes through unmodified.
  const upstream = httpRequest(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream unavailable');
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const rewritten = collapseWsPath(req.url ?? '/');
  const upstream = connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    // Replay the upgrade handshake verbatim except for the rewritten request line,
    // then get out of the way and splice the two sockets together.
    const headerLines = Object.entries(req.headers).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((v) => `${key}: ${v}`) : [`${key}: ${value}`],
    );
    upstream.write(`GET ${rewritten} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const drop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on('error', drop);
  socket.on('error', drop);
});

server.listen(PORT, () => {
  console.log(`[ws-path-shim] :${PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
