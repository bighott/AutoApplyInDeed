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
    rollupOptions: {
      // The dashboard is an extension page opened via chrome.runtime.getURL
      // (not referenced in the manifest), so it must be declared as an explicit
      // HTML input or crxjs won't bundle its script/deps. The popup IS in the
      // manifest (action.default_popup), so crxjs handles it automatically.
      input: {
        dashboard: 'src/ui/dashboard/index.html',
      },
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
