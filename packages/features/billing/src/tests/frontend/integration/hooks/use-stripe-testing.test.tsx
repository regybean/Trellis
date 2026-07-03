/**
 * useStripeTesting — integration/hooks (ADR 0018).
 *
 * The hook's contract: create a demo Checkout session and run the tier-gated
 * feature-test queries, branching on the TYPED billing error code carried in the
 * tRPC error message (stripe-errors.ts) — no substring matching. Drive the real
 * hook through a real QueryClient with the network faked at the HTTP boundary
 * (MSW). Toasts are asserted as DOM text via the real <ToastContainer /> (never
 * mock react-toastify); the typed-error branch is proven by asserting the
 * specific mapped toast text, not by inspecting which handler fired.
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

import { useStripeTesting } from '../../../../hooks/use-stripe-testing';
import { BillingErrorCode } from '../../../../utils/stripe-errors';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

// The success branch calls globalThis.location.assign. jsdom's location is
// non-configurable, so we stub the whole object — but must preserve `origin`,
// since the tRPC httpLink resolves its request URL against it. We capture the
// assigned url so the redirect is observable.
let assignedUrl: string | null = null;
beforeEach(() => {
  assignedUrl = null;
  const { origin } = globalThis.location;
  vi.stubGlobal('location', {
    origin,
    assign: (url: string) => {
      assignedUrl = url;
    },
  });
});

const renderStripeTesting = () =>
  renderHook(() => useStripeTesting(), { wrapper: Providers });

describe('useStripeTesting', () => {
  it('toasts and navigates when a checkout session is created', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(() => ({
        checkoutTimestamp: Date.now(),
        customerId: 'cus_test',
        customerEmail: 'user@test.dev',
        isReturningCustomer: false,
        sessionId: 'sess_test',
        checkoutUrl: 'https://stripe.test/checkout/session',
      })),
    );

    const { result } = renderStripeTesting();

    act(() => result.current.testCheckout('price_standard_test'));

    expect(
      await screen.findByText(/redirecting to stripe checkout/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(assignedUrl).toBe('https://stripe.test/checkout/session'),
    );
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

    const { result } = renderStripeTesting();

    act(() => result.current.testCheckout('price_standard_test'));

    // Proves the structural (typed-code) branch, not substring matching.
    expect(
      await screen.findByText(/you already have an active subscription/i),
    ).toBeInTheDocument();
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

    const { result } = renderStripeTesting();

    act(() => result.current.testCheckout('price_standard_test'));

    expect(
      await screen.findByText(/service currently unavailable/i),
    ).toBeInTheDocument();
  });

  it('toasts the feature message when a standard feature test passes', async () => {
    server.use(
      trpcMsw.account.standardFeature.query(() => ({
        message: 'This feature is available to standard subscribers!',
        subscriptionInfo: {
          status: 'active',
          subscriptionId: 'sub_123',
          product: 'prod_standard',
          priceId: 'price_standard',
          currentPeriodStart: 0,
          currentPeriodEnd: 0,
          cancelAtPeriodEnd: false,
          paymentMethod: null,
        },
      })),
    );

    const { result } = renderStripeTesting();

    await act(() => result.current.runFeatureTest('standard'));

    expect(
      await screen.findByText(/available to standard subscribers/i),
    ).toBeInTheDocument();
  });

  it('maps a typed error from a failed tier-gated feature test', async () => {
    server.use(
      trpcMsw.account.proFeature.query(() => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: BillingErrorCode.StripeUnavailable,
        });
      }),
    );

    const { result } = renderStripeTesting();

    await act(() => result.current.runFeatureTest('pro'));

    expect(
      await screen.findByText(/stripe service error/i),
    ).toBeInTheDocument();
  });

  it('reports isCreatingCheckout while the checkout mutation is in flight', async () => {
    server.use(
      trpcMsw.account.createCheckoutSession.mutation(
        () =>
          new Promise<never>(() => {
            /* never resolves */
          }),
      ),
    );

    const { result } = renderStripeTesting();
    expect(result.current.isCreatingCheckout).toBe(false);

    act(() => result.current.testCheckout('price_standard_test'));

    await waitFor(() => expect(result.current.isCreatingCheckout).toBe(true));
  });
});
