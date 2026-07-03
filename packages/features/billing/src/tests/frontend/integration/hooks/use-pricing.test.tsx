/**
 * usePricing — integration/hooks (ADR 0018).
 *
 * The hook's contract: derive each plan's CTA state from the viewer's
 * Subscription (via the pure plan-selection tree), and route plan selection —
 * signed-out to sign-in, Basic subscribers to Checkout, paid subscribers to the
 * Billing portal. Drive the real hook through a real QueryClient with the
 * network faked at the HTTP boundary (MSW); @acme/auth is the blessed framework
 * external. Assert returned card state + observable toast/navigation outcomes,
 * never spy on mutations. NODE_ENV==='test' so `isDev` is false — the real
 * checkout/portal branches run (not the dev shortcut).
 */
import type { Mock } from 'vitest';
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

import { useAuth } from '@acme/auth';

import { usePricing } from '../../../../hooks/use-pricing';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
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

const setAuth = (opts: { loaded?: boolean; signedIn?: boolean }) => {
  (useAuth as Mock).mockReturnValue({
    isLoaded: opts.loaded ?? true,
    isSignedIn: opts.signedIn ?? false,
    userId: opts.signedIn ? 'user_1' : null,
    sessionId: opts.signedIn ? 'sess_1' : null,
  });
};

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
  it('reports isDev=false and one card per plan under the test env', () => {
    setAuth({ signedIn: false });

    const { result } = renderUsePricing();

    expect(result.current.isDev).toBe(false);
    expect(result.current.cards).toHaveLength(3);
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
