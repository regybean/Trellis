import 'fake-indexeddb/auto';

import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import { ToastContainer } from 'react-toastify';
import superjson from 'superjson';
import { beforeEach } from 'vitest';

import { AppQueryClientProvider } from '@acme/hooks';

import type { AppRouter } from '../../api/root';
import { TRPCProvider } from '../../trpc/react';

import '@testing-library/jest-dom';
// jsdom gaps the Radix primitives rely on (ResizeObserver, pointer capture).
import '@acme/test-utils/jsdom';

// jsdom ships no IndexedDB; `fake-indexeddb/auto` installs an in-memory one so
// the query persister (ADR 0025) can be exercised. A fresh factory per test
// keeps persisted caches from leaking across cases.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// NODE_ENV='test' (shared vitest base env) makes trpc/react use a plain httpLink
// msw-trpc can intercept. Env is real (validated by ../../env). We fake the
// network at the HTTP boundary with MSW and assert what renders — never mock the
// tRPC client, a feature hook, or react-toastify (ADR 0018).

/**
 * Providers every chat frontend test renders under: the app's single QueryClient
 * (ADR 0036 — a feature provider renders none of its own, so a test has to mount
 * one exactly as an app does), the feature's tRPC provider, plus a real
 * `<ToastContainer />` so the orphan-reconcile "credits refunded" toast is
 * asserted as DOM text (ADR 0018), never via a mocked `toast`.
 *
 * `AppQueryClientProvider` builds its client in `useState`, so each `render` /
 * `renderHook` gets its own — a fresh mount is a genuine cold cache and nothing
 * leaks between cases.
 */
export const Providers = ({ children }: { children: ReactNode }) => (
  <AppQueryClientProvider>
    <TRPCProvider>
      {children}
      <ToastContainer />
    </TRPCProvider>
  </AppQueryClientProvider>
);

/**
 * Providers with the query persister wired for a given per-user `scopeKey`
 * (ADR 0025). Used by the offline-restore tests to prime and then cold-restore a
 * persisted cache; the default `Providers` passes no `scopeKey`, so persistence
 * stays off for every other test (network-only, unchanged).
 *
 * This used to nest a second, persister-less `QueryClientProvider` between chat's
 * provider and the component, as a regression guard for the pinning that #82
 * needed. There is nothing left to guard: chat's queries carry their persister in
 * their own options now, and a nested client would be a bug in the test rather
 * than a hazard the feature has to survive.
 */
export const ScopedProviders =
  (scopeKey: string) =>
  ({ children }: { children: ReactNode }) => (
    <AppQueryClientProvider>
      <TRPCProvider scopeKey={scopeKey}>
        {children}
        <ToastContainer />
      </TRPCProvider>
    </AppQueryClientProvider>
  );

/** Render a component wrapped in the feature's tRPC + React Query providers. */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: Providers, ...options });

/**
 * Type-safe MSW request handlers for this feature's router. Use in tests like:
 *   server.use(trpcMsw.chat.get.query(() => []));
 */
export const trpcMsw = createTRPCMsw<AppRouter>({
  links: [mswHttpLink({ url: 'http://localhost:3000/api/trpc/chat' })],
  transformer: { input: superjson, output: superjson },
});

// jsdom doesn't implement matchMedia; the sidebar rail reads it for its
// mobile default. Report desktop (matches:false) so tests render expanded.
globalThis.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {
    // no-op
  },
  removeEventListener: () => {
    // no-op
  },
  addListener: () => {
    // no-op
  },
  removeListener: () => {
    // no-op
  },
  dispatchEvent: () => false,
});
