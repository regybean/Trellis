import type { RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import superjson from 'superjson';

import type { AppRouter } from '../../api/root';
import { TRPCReactProvider } from '../../trpc/react';

// NODE_ENV='test' (from the shared vitest base env) makes the provider use a
// plain httpLink (see trpc/react.tsx), which msw-trpc can intercept. Env is
// real (validated by ../../env) — see @acme/test-utils/vitest staticTestEnv.

/** Render a component wrapped in the feature's tRPC + React Query providers. */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) =>
  render(ui, {
    wrapper: ({ children }) => (
      <TRPCReactProvider>{children}</TRPCReactProvider>
    ),
    ...options,
  });

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
