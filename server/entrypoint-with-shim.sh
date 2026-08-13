#!/bin/bash
# Wraps the standalone image's entrypoint so one Railway service exposes the
# ws-path-shim publicly while y/hub keeps its internal port.
#
# Railway injects PORT for the public listener. y/hub inside the image ALSO
# reads PORT, so without the split below the two processes would fight over
# one port: the shim takes the public one, y/hub is pinned to 3002.
set -e

PUBLIC_PORT="${PORT:-8080}"
YHUB_PORT=3002

# The shim starts immediately; it proxies 502s until y/hub is up, which is fine.
PORT="$PUBLIC_PORT" UPSTREAM_HOST=127.0.0.1 UPSTREAM_PORT="$YHUB_PORT" \
  node /usr/src/app/ws-path-shim.mjs &

# Hand control to the original entrypoint (postgres + valkey + y/hub).
export PORT="$YHUB_PORT"
exec /usr/src/app/entrypoint.sh
