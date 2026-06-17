import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

// `server-only` resolves to a throwing module unless the `react-server` export
// condition is set. Next.js sets it for its server-component bundle; TanStack
// Start's server runtime does not, so shared @acme/*/server modules (consumed by
// both apps) throw on import even on the server. Stub it to an empty module in
// the server build only — the client build keeps the throwing default so
// accidental server imports in client code are still caught.
const stubServerOnly = (): Plugin => {
  const stubId = '\0server-only-stub';
  return {
    name: 'stub-server-only-on-server',
    // Run before tanstackStart()/nitro() so we see the bare `server-only`
    // specifier before they resolve it to an absolute node_modules path.
    enforce: 'pre',
    resolveId(id) {
      // Stub in every environment except the client bundle. The legacy
      // `options.ssr` flag isn't reliably true under TanStack Start / Nitro's
      // per-environment graph (Vite Environment API), so gate on the
      // environment name instead. The client build keeps the throwing default
      // so accidental server imports in client code are still caught.
      if (id === 'server-only' && this.environment.name !== 'client') {
        return stubId;
      }
    },
    load(id) {
      if (id === stubId) return 'export {};';
    },
  };
};

// The shared feature env schemas use `@t3-oss/env-nextjs`, which validates
// client/shared vars against `process.env` when each feature's `env` module
// loads. Next.js statically inlines `process.env.NEXT_PUBLIC_*` into the browser
// bundle; Vite does not (it exposes vars via `import.meta.env`), so in the client
// those reads are `undefined` and the schemas throw on import — billing's
// NEXT_PUBLIC_STRIPE_* (client) and chat/ingest's NEXT_PUBLIC_WEBAPP (shared).
// Every feature TRPCReactProvider imports its `env`, so the throw crashes the
// whole __root tree and silently kills hydration (inputs/buttons stay in their
// initial disabled state). Mirror Next's inlining here so the shared packages
// can stay framework-neutral on `process.env`: replace each public
// `process.env.<KEY>` with its literal value in the client bundle. Server secrets
// (DB_*, REDIS_URL, STRIPE_SECRET_KEY) are left to read real `process.env` on the
// server — they are never inlined and never reach the browser.
const publicEnvDefine = Object.fromEntries(
  Object.entries(process.env)
    .filter(
      ([key]) => key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_'),
    )
    .map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
);

export default defineConfig({
  // Expose the shared NEXT_PUBLIC_* env (reused from the Next.js app) to the
  // client bundle so <ClerkProvider> can read the publishable key.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  // Inline public env into the client bundle (see publicEnvDefine above).
  define: publicEnvDefine,
  server: {
    port: 3003,
  },
  // Vite externalizes regular node_modules deps in the SSR build, so `server-only`
  // would be loaded by Node's native loader (and throw) before stubServerOnly()
  // can intercept it. Force it through Vite's resolve pipeline instead.
  ssr: {
    noExternal: ['server-only'],
  },
  plugins: [
    stubServerOnly(),
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    // Nitro bundles the whole server graph in prod (resolve.noExternal: true),
    // feeding ctx.bundlerConfig.rollupConfig into build.rollupOptions. officeparser
    // (via @acme/rag) dynamically imports puppeteer in its optional PdfGenerator
    // path, which we never call — Rollup still tries to resolve it and fails.
    // Externalize puppeteer so it stays an unbundled (absent) import.
    //
    // `plugins`: register the app-owned telemetry bootstrap as a Nitro startup
    // plugin (initializes the OTel SDK at the server boundary — ADR-0005).
    // Registered explicitly by absolute path rather than relying on Nitro's
    // `plugins/` auto-scan, whose scan root is ambiguous under TanStack Start.
    nitro({
      rollupConfig: { external: ['puppeteer'] },
      plugins: [
        fileURLToPath(new URL('./src/nitro/telemetry.ts', import.meta.url)),
      ],
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
