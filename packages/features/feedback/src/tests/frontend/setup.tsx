import 'fake-indexeddb/auto';

import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import superjson from 'superjson';
import { beforeEach } from 'vitest';

import type { AppRouter } from '../../api/root';
import { TRPCReactProvider } from '../../trpc/react';

// NODE_ENV='test' (from the shared vitest base env) makes the provider use a
// plain httpLink (see trpc/react.tsx), which msw-trpc can intercept. Env is
// real (validated by ../../env) — see @acme/test-utils/vitest staticTestEnv.

// jsdom has no IndexedDB; `fake-indexeddb/auto` installs an in-memory one on the
// global. Swap in a fresh factory before each test so persisted caches never
// leak across cases (ADR 0025 / ADR 0018).
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

/**
 * The feature's provider tree. Used as the `renderWithProviders` wrapper and as
 * the `renderHook` wrapper for `integration/hooks` tests. A `scopeKey` opts
 * persistence on (offline-read tests); omitted, the feature runs network-only.
 *
 * A *foreign* `QueryClientProvider` is nested inside feedback's provider to
 * mirror how apps mount several feature providers (feedback lives inside chat's
 * message list, itself inside chat's provider). react-query's `useQuery` binds
 * to the nearest client in context, so unless feedback's hook pins its own
 * client (#82) its `forMessage` query would run on this persister-less foreign
 * client and never persist. Keeping it makes the offline-restore case a
 * regression guard for that pinning.
 */
export const Providers = ({
  children,
  scopeKey,
}: {
  children: ReactNode;
  scopeKey?: string;
}) => (
  <TRPCReactProvider scopeKey={scopeKey}>
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  </TRPCReactProvider>
);

/** Render a component wrapped in the feature's tRPC + React Query providers. */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: Providers, ...options });

/**
 * Type-safe MSW request handlers for this feature's router. Use in tests like:
 *   server.use(trpcMsw.feedback.list.query(() => [...]));
 */
export const trpcMsw = createTRPCMsw<AppRouter>({
  links: [mswHttpLink({ url: 'http://localhost:3000/api/trpc/feedback' })],
  transformer: { input: superjson, output: superjson },
});

// --- jsdom gaps some UI primitives rely on -------------------------------
class ResizeObserverMock {
  observe() {
    // no-op
  }
  unobserve() {
    // no-op
  }
  disconnect() {
    // no-op
  }
}
globalThis.ResizeObserver = ResizeObserverMock;

if (!('hasPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.hasPointerCapture = () => false;
}
if (!('setPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.setPointerCapture = () => {
    // no-op
  };
}
if (!('releasePointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.releasePointerCapture = () => {
    // no-op
  };
}
