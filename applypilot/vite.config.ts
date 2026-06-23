import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

/**
 * Build with @crxjs/vite-plugin, which reads manifest.json, bundles the
 * service worker / content scripts / HTML entry points correctly for MV3, and
 * wires up the dev-mode HMR. Output goes to dist/ — load that folder unpacked.
 */
export default defineConfig({
  // JSON-imported manifest is typed loosely (e.g. manifest_version: number);
  // cast so the strict ManifestV3 type on crx() is satisfied.
  plugins: [crx({ manifest: manifest as unknown as Parameters<typeof crx>[0]['manifest'] })],
  build: {
    outDir: 'dist',
    // The dashboard is the manifest's options_page, so crxjs bundles it (and
    // its pdfjs/mammoth deps) automatically — no manual input needed.
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
  // pdfjs worker is pulled in via `?url`; ensure the worker isn't pre-bundled.
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
});
