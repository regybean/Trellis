import 'fake-indexeddb/auto';

import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
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
 */
export const Providers = ({
  children,
  scopeKey,
}: {
  children: ReactNode;
  scopeKey?: string;
}) => <TRPCReactProvider scopeKey={scopeKey}>{children}</TRPCReactProvider>;

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
