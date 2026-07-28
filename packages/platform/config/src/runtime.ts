/**
 * The runtime side of a {@link ConfigContext} — server vs. browser — that the
 * app's config edge threads into every slice factory alongside `appEnv`.
 *
 * A react-query-free replacement for `@tanstack/react-query`'s `isServer`:
 * importing that value binding evaluates the whole react-query barrel
 * (`QueryClientProvider` → `React.createContext`), and the app config edge is
 * reachable from the Generation worker (`worker.ts` → `./src/config`), which
 * runs under `tsx --conditions=react-server` where `React.createContext` does
 * not exist — so pulling react-query in there crashes the worker at startup.
 * Equivalent to react-query's `typeof window === 'undefined'`, but written
 * against `globalThis` so it type-checks in this DOM-lib-free platform package.
 */
export const isServer = !('window' in globalThis);
