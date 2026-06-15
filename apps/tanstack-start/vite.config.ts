import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Expose the shared NEXT_PUBLIC_* env (reused from the Next.js app) to the
  // client bundle so <ClerkProvider> can read the publishable key.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 3001,
  },
  plugins: [
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    // Nitro bundles the whole server graph in prod (resolve.noExternal: true),
    // feeding ctx.bundlerConfig.rollupConfig into build.rollupOptions. officeparser
    // (via @acme/rag) dynamically imports puppeteer in its optional PdfGenerator
    // path, which we never call — Rollup still tries to resolve it and fails.
    // Externalize puppeteer so it stays an unbundled (absent) import.
    nitro({ rollupConfig: { external: ['puppeteer'] } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
