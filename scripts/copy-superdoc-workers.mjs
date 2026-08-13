/**
 * SuperDoc v2 runs its DOCX engine in three Web Workers shipped inside
 * `@superdoc/docx-engine`. Left to itself the runtime resolves them relative to
 * its own module URL, which under pnpm lands on the virtual-store path
 * `node_modules/.pnpm/node_modules/...` that Vite's dev server will not serve —
 * the editor then fails with "the browser worker failed to start".
 *
 * SuperDoc documents `workerUrls` as the escape hatch for exactly this (its
 * stated use case is a bundle served from a different origin than the app). We
 * copy the three bundles into `public/` under stable names and point at them
 * explicitly. That fixes dev under pnpm *and* removes the GitHub Pages risk of
 * worker URLs resolving outside the `/superdoc-timeline/` base path, because
 * the URLs are now ours and are built from `import.meta.env.BASE_URL`.
 *
 * The bundles are self-contained (no cross-imports), so renaming is safe.
 */
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'superdoc-workers');

/** Prefix in the published asset filename -> the `workerUrls` key it satisfies. */
const ROLES = {
  'browser-worker-entry-': 'document',
  'collaboration-worker-entry-': 'collaboration',
  'review-index-worker-entry-': 'reviewIndex',
};

/** pnpm's layout differs from npm's, so try both rather than assuming one. */
const CANDIDATE_DIRS = [
  join(ROOT, 'node_modules/.pnpm/node_modules/@superdoc/docx-engine/dist/assets'),
  join(ROOT, 'node_modules/@superdoc/docx-engine/dist/assets'),
  join(ROOT, 'node_modules/superdoc/node_modules/@superdoc/docx-engine/dist/assets'),
];

async function findAssetsDir() {
  for (const dir of CANDIDATE_DIRS) {
    try {
      const entries = await readdir(dir);
      if (entries.some((f) => f.endsWith('.js'))) return { dir, entries };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Could not find @superdoc/docx-engine worker assets. Looked in:\n  ${CANDIDATE_DIRS.join('\n  ')}`,
  );
}

const { dir, entries } = await findAssetsDir();
await mkdir(OUT_DIR, { recursive: true });

const manifest = {};
for (const [prefix, role] of Object.entries(ROLES)) {
  const match = entries.find((f) => f.startsWith(prefix) && f.endsWith('.js'));
  if (!match) throw new Error(`No worker asset matching "${prefix}*" in ${dir}`);
  const outName = `${role}.js`;
  await copyFile(join(dir, match), join(OUT_DIR, outName));
  manifest[role] = outName;
}

// Emitted so the app never hardcodes filenames the upstream package controls.
await writeFile(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`[superdoc-workers] copied ${Object.keys(manifest).length} bundles from ${dir}`);
