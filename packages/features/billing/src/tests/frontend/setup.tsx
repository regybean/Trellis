import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import { ToastContainer } from 'react-toastify';
import superjson from 'superjson';
import { vi } from 'vitest';

import type { AppRouter } from '../../api/root';
import { TRPCReactProvider } from '../../trpc/react';

import '@testing-library/jest-dom';

// NODE_ENV='test' (shared vitest base env) makes trpc/react use a plain httpLink
// msw-trpc can intercept. Env is real (validated by ../../env). We fake the
// network at the HTTP boundary with MSW and assert what renders — never mock the
// tRPC client, a feature hook, or react-toastify (ADR 0018).

// Mock next/navigation — an allowed framework external (ADR 0018 / ADR 0014).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock the neutral @acme/auth surface — allowed framework external (ADR 0018).
vi.mock('@acme/auth', () => ({
  useAuth: vi.fn(),
}));

/**
 * Providers every billing frontend test renders under: the feature's tRPC +
 * React Query provider, plus a real `<ToastContainer />` so success/error
 * toasts are asserted as DOM text (ADR 0018), not via a mocked `toast`.
 */
export const Providers = ({ children }: { children: ReactNode }) => (
  <TRPCReactProvider>
    {children}
    <ToastContainer />
  </TRPCReactProvider>
);

/** Render a component wrapped in the feature's providers + ToastContainer. */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: Providers, ...options });

/**
 * Type-safe MSW request handlers for this feature's router. Use in tests like:
 *   server.use(trpcMsw.account.getSubscriptionDetails.query(() => ({...})));
 */
export const trpcMsw = createTRPCMsw<AppRouter>({
  links: [mswHttpLink({ url: 'http://localhost:3000/api/trpc/billing' })],
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
