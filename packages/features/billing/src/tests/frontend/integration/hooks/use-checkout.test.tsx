/**
 * useCheckout — integration/hooks (ADR 0018).
 *
 * The hook's contract: `checkout()` / `openBillingPortal()` fire the Stripe
 * session mutations, surface a redirect toast on success and an error toast on
 * failure, and expose an aggregate `isPending`. Drive the real hook through a
 * real QueryClient with the network faked at the HTTP boundary (MSW). Toasts are
 * asserted as DOM text via the real <ToastContainer /> (never mock
 * react-toastify). Redirects go through globalThis.location.href, intercepted
 * here (href only) so the assertion is observable without breaking the tRPC
 * httpLink URL, which resolves against location.origin.
 */
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { TRPCError } from '@trpc/server';
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

import { useCheckout } from '../../../../hooks/use-checkout';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
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

// renderHook drops sibling DOM (toasts render at document.body via a portal, so
// they survive), but we mount the hook alongside a ToastContainer through
// Providers, which already includes one.
const renderUseCheckout = () =>
  renderHook(() => useCheckout(), { wrapper: Providers });

const checkoutOk = (url: string | null) =>
  trpcMsw.account.createCheckoutSession.mutation(() => ({
    checkoutTimestamp: Date.now(),
    customerId: 'cus_test',
    customerEmail: 'user@test.dev',
    isReturningCustomer: false,
    sessionId: 'sess_test',
    checkoutUrl: url,
  }));

const dashboardOk = (url: string) =>
  trpcMsw.account.createDashboardSession.mutation(() => ({
    success: true,
    billingPortalUrl: url,
    message: 'ok',
  }));

describe('useCheckout', () => {
  it('surfaces a redirect toast and navigates after checkout succeeds', async () => {
    server.use(checkoutOk('https://stripe.test/checkout/session'));

    const { result } = renderUseCheckout();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/redirecting to checkout/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/checkout/session'),
    );
  });

  it('shows an error toast when checkout returns no url', async () => {
    server.use(checkoutOk(null));

    const { result } = renderUseCheckout();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/failed to create checkout session/i),
    ).toBeInTheDocument();
    expect(assignedHref).toBeNull();
  });

  it('surfaces a redirect toast and navigates when opening the billing portal', async () => {
    server.use(dashboardOk('https://stripe.test/billing-portal'));

    const { result } = renderUseCheckout();

    act(() => result.current.openBillingPortal());

    expect(
      await screen.findByText(/redirecting to stripe dashboard/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/billing-portal'),
    );
  });

  it('shows the generic error toast when the checkout mutation errors', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(() => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'boom',
        });
      }),
    );

    const { result } = renderUseCheckout();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/service currently unavailable/i),
    ).toBeInTheDocument();
  });

  it('reports isPending true while the checkout mutation is in flight', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(
        () =>
          new Promise<never>(() => {
            /* never resolves — keeps the mutation pending */
          }),
      ),
    );

    const { result } = renderUseCheckout();
    expect(result.current.isPending).toBe(false);

    act(() => result.current.checkout('price_standard_test'));

    await waitFor(() => expect(result.current.isPending).toBe(true));
  });
});
