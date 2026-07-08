// Stub for the `server-only` package.
//
// `@acme/trpc` (and every feature's `index-server.ts`) begins with
// `import 'server-only'`, whose real module throws unless the `react-server`
// export condition is set — a guard for Next.js, meant to blow up when a
// server module is pulled into a client bundle. This host is a plain Node
// process with no client bundle, so the guard is irrelevant; an empty module
// lets the server graph import cleanly. Wired via tsconfig `paths` so `tsx`
// resolves the bare `server-only` specifier here.
//
// Mirrors the `stubServerOnly` Vite plugin in `apps/tanstack-slim`.
export const serverOnlyStub = true;
