import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import { ToastContainer } from 'react-toastify';
import superjson from 'superjson';
import { vi } from 'vitest';

import type { AppRouter } from '../../api/root';
import { BillingConfigProvider } from '../../config-context';
import { TRPCReactProvider } from '../../trpc/react';

import '@testing-library/jest-dom';

/**
 * The billing values the client seam reads (ADR 0033), supplied directly here —
 * config is pure, so a test constructs it with no env. The plan IDs match the
 * subscription-cache products the MSW handlers/backends seed.
 */
const testBillingConfig = {
  STRIPE_STANDARD_PLAN_ID: 'price_standard_test',
  STRIPE_PRO_PLAN_ID: 'price_pro_test',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  STRIPE_MANAGE_BILLING_URL: 'https://billing.example.test/manage',
};

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
 * Build the providers every billing frontend test renders under: the feature's
 * tRPC + React Query provider, the `BillingConfigProvider` carrying the client
 * config + server-derived localstripe mode, and a real `<ToastContainer />` so
 * success/error toasts are asserted as DOM text (ADR 0018), not via a mocked
 * `toast`. `localstripeMode` defaults to `false` (real Stripe) — the mode is
 * threaded through the provider seam, so a test opts into localstripe by passing
 * `{ localstripeMode: true }` rather than touching `NODE_ENV`.
 */
export const makeProviders =
  (opts?: { localstripeMode?: boolean }) =>
  ({ children }: { children: ReactNode }) => (
    <TRPCReactProvider>
      <BillingConfigProvider
        config={testBillingConfig}
        localstripeMode={opts?.localstripeMode ?? false}
      >
        {children}
        <ToastContainer />
      </BillingConfigProvider>
    </TRPCReactProvider>
  );

/** The default (real-Stripe) providers wrapper. */
export const Providers = makeProviders();

/** Render a component wrapped in the feature's providers + ToastContainer. */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { localstripeMode?: boolean },
) => {
  const { localstripeMode, ...renderOptions } = options ?? {};
  return render(ui, {
    wrapper: makeProviders({ localstripeMode }),
    ...renderOptions,
  });
};

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
