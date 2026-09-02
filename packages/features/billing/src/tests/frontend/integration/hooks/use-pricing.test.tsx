/**
 * usePricing — integration/hooks (ADR 0018).
 *
 * The hook's contract: derive each plan's CTA state from the viewer's
 * Subscription (via the pure plan-selection tree), and route plan selection —
 * signed-out to sign-in, Basic subscribers to Checkout, paid subscribers to the
 * Billing portal. Drive the real hook through a real QueryClient with the
 * network faked at the HTTP boundary (MSW); @acme/auth is the blessed framework
 * external. Assert returned card state + observable toast/navigation outcomes,
 * never spy on mutations. `localstripeMode` arrives through the
 * `BillingConfigProvider` seam (never `NODE_ENV`): the default providers thread
 * `false`, so the real checkout/portal branches run; a localstripe test opts in
 * with `makeProviders({ localstripeMode: true })`.
 */
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { usePricing } from '../../../../hooks/use-pricing';
import {
  makeProviders,
  Providers,
  resetAuth,
  setAuth,
  trpcMsw,
} from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  resetAuth();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

// The hook redirects by assigning globalThis.location.href in an effect. jsdom's
// location is non-configurable, so we stub the whole object — but must preserve
// `origin`, since the tRPC httpLink resolves its request URL against it. We
// capture the assigned href so the redirect is observable.
let assignedHref: string | null = null;
beforeEach(() => {
  assignedHref = null;
  const { origin } = globalThis.location;
  vi.stubGlobal('location', {
    origin,
    get href() {
      return assignedHref ?? '';
    },
    set href(value: string) {
      assignedHref = value;
    },
  });
});

const basicSub = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Basic' as const,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    cancelAtPeriodEnd: false,
    status: 'none' as const,
  }));

const standardSub = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Standard' as const,
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
    currentPeriodStart: Math.floor(Date.now() / 1000) - 86_400,
    cancelAtPeriodEnd: false,
    status: 'active' as const,
  }));

const renderUsePricing = () =>
  renderHook(() => usePricing(), { wrapper: Providers });

const card = (
  result: { current: ReturnType<typeof usePricing> },
  name: string,
) => result.current.cards.find((c) => c.plan.name === name);

describe('usePricing', () => {
  it('reports localstripeMode=false (real Stripe) and one card per plan under the default config', () => {
    setAuth({ signedIn: false });

    const { result } = renderUsePricing();

    expect(result.current.localstripeMode).toBe(false);
    expect(result.current.cards).toHaveLength(3);
  });

  it('reads localstripe mode from the config seam and blocks Checkout with an admin-grant toast', async () => {
    // Config threaded with localstripeMode=true (not NODE_ENV): a signed-in
    // Basic user selecting a paid plan is told to use the admin page rather than
    // routed to Checkout, since localstripe has no Checkout API.
    setAuth({ signedIn: true });
    server.use(basicSub());

    const { result } = renderHook(() => usePricing(), {
      wrapper: makeProviders({ localstripeMode: true }),
    });

    await waitFor(() =>
      expect(card(result, 'Standard')?.buttonState.variant).toBe('purchase'),
    );
    expect(result.current.localstripeMode).toBe(true);

    act(() => {
      const standard = card(result, 'Standard');
      if (standard) result.current.selectPlan(standard.plan);
    });

    // Observable outcome: the admin-grant toast, and no redirect to Checkout.
    expect(
      await screen.findByText(/checkout is unavailable in dev/i),
    ).toBeInTheDocument();
    expect(assignedHref).toBeNull();
  });

  it('derives sign-in CTA states when logged out', () => {
    setAuth({ signedIn: false });

    const { result } = renderUsePricing();

    expect(card(result, 'Basic')?.buttonState).toMatchObject({
      variant: 'signin',
      text: 'Login to Start',
      disabled: false,
    });
    expect(card(result, 'Standard')?.buttonState.variant).toBe('signin');
  });

  it('marks the current plan selected and offers upgrade for a Standard subscriber', async () => {
    setAuth({ signedIn: true });
    server.use(standardSub());

    const { result } = renderUsePricing();

    await waitFor(() =>
      expect(card(result, 'Standard')?.buttonState.variant).toBe('selected'),
    );
    expect(card(result, 'Standard')?.buttonState.disabled).toBe(true);
    expect(card(result, 'Pro')?.buttonState).toMatchObject({
      variant: 'upgrade',
      disabled: false,
    });
  });

  it('redirects to sign-in when a logged-out viewer selects a plan', () => {
    setAuth({ signedIn: false });

    const { result } = renderUsePricing();

    act(() => {
      const standard = card(result, 'Standard');
      if (standard) result.current.selectPlan(standard.plan);
    });

    expect(assignedHref).toBe('/sign-in');
  });

  it('routes a Basic subscriber through Checkout and toasts the redirect', async () => {
    setAuth({ signedIn: true });
    server.use(
      basicSub(),
      trpcMsw.account.createCheckoutSession.mutation(() => ({
        checkoutTimestamp: Date.now(),
        customerId: 'cus_test',
        customerEmail: 'user@test.dev',
        isReturningCustomer: false,
        sessionId: 'sess_test',
        checkoutUrl: 'https://stripe.test/checkout/session',
      })),
    );

    const { result } = renderUsePricing();
    await waitFor(() =>
      expect(card(result, 'Standard')?.buttonState.variant).toBe('purchase'),
    );

    act(() => {
      const standard = card(result, 'Standard');
      if (standard) result.current.selectPlan(standard.plan);
    });

    expect(
      await screen.findByText(/redirecting to checkout/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/checkout/session'),
    );
  });

  it('routes an existing paid subscriber through the Billing portal', async () => {
    setAuth({ signedIn: true });
    server.use(
      standardSub(),
      trpcMsw.account.createDashboardSession.mutation(() => ({
        success: true,
        billingPortalUrl: 'https://stripe.test/billing-portal',
        message: 'ok',
      })),
    );

    const { result } = renderUsePricing();
    await waitFor(() =>
      expect(card(result, 'Pro')?.buttonState.variant).toBe('upgrade'),
    );

    act(() => {
      const pro = card(result, 'Pro');
      if (pro) result.current.selectPlan(pro.plan);
    });

    expect(
      await screen.findByText(/redirecting to stripe dashboard/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/billing-portal'),
    );
  });
});
