import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
// Write into the SAME collapsed room SuperDoc created, as a second device.
const provider = new WebsocketProvider(
  'ws://localhost:4403/api/ws/v1/superdoc-timeline', 'sd2__v2.1__v14demo',
  new Y.Doc(), { WebSocketPolyfill: WebSocket, params: { yauth: 'bob-device', customAttributions: 'name:Bob' } },
);
const doc = provider.doc;
const ok = await new Promise((r) => { const t = setTimeout(() => r(false), 12000);
  provider.on('sync', (s) => { if (s) { clearTimeout(t); r(true); } }); });
if (ok) {
  const text = doc.getText('bob-side-channel'); // separate root: never touches SuperDoc's schema
  for (let i = 0; i < 12; i += 1) {
    text.insert(text.length, 'b'.repeat(8));
    await new Promise((r) => setTimeout(r, 7000)); // >5s gaps → distinct grouped entries
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(JSON.stringify({ synced: ok }));
provider.destroy(); process.exit(0);
