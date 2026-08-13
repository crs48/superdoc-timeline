# y/hub standalone (Postgres 16 + Valkey + y/hub in one container), patched:
#
#  1. bin/yhub.js — the stock image attributes every connection to a random
#     cartoon character; the patch records the client's `yauth` (deviceId) so
#     the Activity API returns real attribution. See server/yhub.js. (The
#     image inlines its config in bin/yhub.js — it predates master's conf.js.)
#  2. ws-path-shim.mjs — SuperDoc v2's y-websocket client requests
#     /api/ws/v1/{org}/sd2/v2.1/{docid}; y/hub resolves rooms by exactly
#     {org}/{docid}. The shim collapses the extra segments. See the file
#     header for the full story.
#
# Mount a volume at /data or every document and all attribution history is
# reinitialized on each deploy.
FROM ghcr.io/yjs/yhub/standalone:latest

# Paths are relative to the repo root: Railway builds with the upload root as
# context (railway.json sets dockerfilePath), and a root context also lets the
# local `docker build -f server/Dockerfile .` match production exactly.
COPY server/yhub.js /usr/src/app/bin/yhub.js
COPY server/ws-path-shim.mjs /usr/src/app/ws-path-shim.mjs
COPY server/entrypoint-with-shim.sh /usr/src/app/entrypoint-with-shim.sh
RUN chmod +x /usr/src/app/entrypoint-with-shim.sh

ENTRYPOINT ["/usr/src/app/entrypoint-with-shim.sh"]
