// Stub for the `server-only` package — see the equivalent in apps/service-host.
// `@acme/rag`'s server graph may begin with `import 'server-only'`, which throws
// outside a `react-server` condition. This migrator is a plain Node/tsx process
// with no client bundle, so the guard is irrelevant; an empty module lets the
// graph import cleanly. Wired via tsconfig `paths`.
export const serverOnlyStub = true;
