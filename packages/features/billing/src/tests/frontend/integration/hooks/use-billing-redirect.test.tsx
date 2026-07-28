/**
 * useBillingRedirect — integration/hooks (ADR 0018).
 *
 * The Billing redirect module is the single home for the create-session →
 * redirect-URL → navigate flow, the loading toast, and the typed billing-error →
 * toast mapping. Because useCheckout and useStripeTesting both compose it, the
 * redirect flow is asserted once here; the compositions assert only their added
 * routing. Drive the real hook through a real QueryClient with the network faked
 * at the HTTP boundary (MSW); toasts asserted as DOM text via the real
 * <ToastContainer /> (never mock react-toastify, the tRPC client, or a hook).
 * Navigation goes through globalThis.location.href, stubbed here (href only) so
 * the destination is observable without breaking the tRPC httpLink URL, which
 * resolves against location.origin.
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

import { useBillingRedirect } from '../../../../hooks/use-billing-redirect';
import { BillingErrorCode } from '../../../../utils/stripe-errors';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

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

const renderRedirect = (...args: Parameters<typeof useBillingRedirect>) =>
  renderHook(() => useBillingRedirect(...args), { wrapper: Providers });

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

describe('useBillingRedirect', () => {
  it('toasts and navigates to the Checkout session on success', async () => {
    server.use(checkoutOk('https://stripe.test/checkout/session'));

    const { result } = renderRedirect();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/redirecting to checkout/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/checkout/session'),
    );
  });

  it('toasts and navigates to the Billing portal on success', async () => {
    server.use(dashboardOk('https://stripe.test/billing-portal'));

    const { result } = renderRedirect();

    act(() => result.current.openBillingPortal());

    expect(
      await screen.findByText(/redirecting to stripe dashboard/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedHref).toBe('https://stripe.test/billing-portal'),
    );
  });

  it('uses the overridden Checkout redirect label', async () => {
    server.use(checkoutOk('https://stripe.test/checkout/session'));

    const { result } = renderRedirect({
      checkout: 'Redirecting to Stripe checkout...',
    });

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/redirecting to stripe checkout/i),
    ).toBeInTheDocument();
  });

  it('shows an error toast (no navigation) when checkout returns no url', async () => {
    server.use(checkoutOk(null));

    const { result } = renderRedirect();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/failed to create checkout session/i),
    ).toBeInTheDocument();
    expect(assignedHref).toBeNull();
  });

  it('maps a typed billing error to its specific toast (ActiveSubscription)', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: BillingErrorCode.ActiveSubscription,
        });
      }),
    );

    const { result } = renderRedirect();

    act(() => result.current.checkout('price_standard_test'));

    // Proves the structural (typed-code) branch, not substring matching.
    expect(
      await screen.findByText(/you already have an active subscription/i),
    ).toBeInTheDocument();
    expect(assignedHref).toBeNull();
  });

  it('falls back to the generic error toast for an unrecognised code', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(() => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'some non-billing failure',
        });
      }),
    );

    const { result } = renderRedirect();

    act(() => result.current.checkout('price_standard_test'));

    expect(
      await screen.findByText(/service currently unavailable/i),
    ).toBeInTheDocument();
  });

  it('reports isPending true while a create-session mutation is in flight', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(
        () =>
          new Promise<never>(() => {
            /* never resolves — keeps the mutation pending */
          }),
      ),
    );

    const { result } = renderRedirect();
    expect(result.current.isPending).toBe(false);

    act(() => result.current.checkout('price_standard_test'));

    await waitFor(() => expect(result.current.isPending).toBe(true));
  });
});
