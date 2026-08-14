/**
 * The UI-prototype galleries live under `docs/explorations/prototypes/` so the
 * exploration docs can link them relatively on GitHub. The app header links to
 * them too, which means GitHub Pages must serve them — so this script mirrors
 * the directory into `public/prototypes/` (gitignored, regenerated on every
 * dev/build like `public/superdoc-workers/`). The docs copy stays canonical.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'explorations', 'prototypes');
const OUT = join(ROOT, 'public', 'prototypes');

await rm(OUT, { recursive: true, force: true });
await mkdir(dirname(OUT), { recursive: true });
await cp(SRC, OUT, { recursive: true });
console.log('[copy-prototypes] docs/explorations/prototypes -> public/prototypes');
