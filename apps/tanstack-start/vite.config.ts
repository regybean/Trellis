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
    nitro(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
