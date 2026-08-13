import * as Y from 'yjs';
import { ORG, collapsedDocId, httpBase } from '@/collab/yhub';

/**
 * The document as it existed at `ts`, reconstructed by the server.
 *
 * y/hub's changeset API returns the room's Yjs update "as it was at `to`" —
 * the backend already stores every version, so History Mode is a query, not a
 * feature. There is deliberately no client-side snapshot store: building one
 * would make the client a second system of record.
 */
export async function fetchDocumentAt(
  roomId: string,
  ts: number,
  signal?: AbortSignal,
): Promise<Y.Doc> {
  const url = `${httpBase()}/api/changeset/v1/${ORG}/${collapsedDocId(roomId)}?to=${ts}&ydoc=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`changeset ${res.status}`);
  const { ydoc } = (await res.json()) as { ydoc?: string };
  if (!ydoc) throw new Error('changeset returned no document');

  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(atob(ydoc), (c) => c.charCodeAt(0)));
  return doc;
}

/**
 * Paragraph texts from a SuperDoc v2 room document.
 *
 * The schema is undocumented (the editor's worker is obfuscated), so this was
 * derived by decoding a live room: the `content` root is a Y.Map of "shards",
 * story shards carry a `blocks` Y.Array, and each block Y.Map holds its prose
 * in a `text` Y.Text. Only the root access needs care — reading a root with
 * the wrong accessor silently re-types it — everything below is already
 * instantiated, so plain `instanceof` checks keep this walk safe against
 * schema drift: unknown shapes yield fewer paragraphs, never a crash.
 */
export function extractParagraphs(doc: Y.Doc): string[] {
  const paragraphs: string[] = [];
  const content = doc.getMap('content');
  for (const shard of content.values()) {
    if (!(shard instanceof Y.Map)) continue;
    const meta = shard.get('meta');
    if (!(meta instanceof Y.Map) || meta.get('shardKind') !== 'story') continue;
    const blocks = shard.get('blocks');
    if (!(blocks instanceof Y.Array)) continue;
    for (const block of blocks) {
      if (block instanceof Y.Map) {
        const text = block.get('text');
        if (text instanceof Y.Text) paragraphs.push(text.toString());
      }
    }
  }
  return paragraphs;
}
