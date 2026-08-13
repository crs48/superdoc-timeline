import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base` must match the GitHub Pages project subpath so that hashed asset URLs —
// including SuperDoc's three Web Worker bundles — resolve under /superdoc-timeline/
// rather than the domain root. Overridable so `vite preview` and local builds work.
const base = process.env.VITE_BASE ?? '/superdoc-timeline/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  // The v2 DOCX engine is a large obfuscated bundle that hands off to Web Workers
  // over a versioned protocol. Running it through Vite's esbuild dep-optimizer
  // breaks that handshake ("the browser worker failed to start"), so serve it as
  // real ESM instead.
  optimizeDeps: {
    exclude: ['superdoc', '@superdoc/docx-engine'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
