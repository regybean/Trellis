/**
 * PricingPage — integration/components (ADR 0018).
 *
 * The real tRPC client + real usePricing hook run through a real QueryClient
 * with the network faked at the HTTP boundary via MSW (trpcMsw). @acme/auth is
 * mocked (allowed framework external). We assert rendered DOM states and
 * observable outcomes (button text, disabled, toast text) — never spy on
 * mutations or mock trpc/react.
 */
import type { Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import '@testing-library/jest-dom';

import { useAuth } from '@acme/auth';

import { PricingPage } from '../../../../components/pricing';
import { renderWithProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const setAuth = (opts: { loaded?: boolean; signedIn?: boolean }) => {
  (useAuth as Mock).mockReturnValue({
    isLoaded: opts.loaded ?? true,
    isSignedIn: opts.signedIn ?? false,
    userId: opts.signedIn ? 'user_1' : null,
    sessionId: opts.signedIn ? 'sess_1' : null,
  });
};

const basicSubscription = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Basic',
    currentPeriodEnd: null,
    currentPeriodStart: null,
    cancelAtPeriodEnd: false,
    status: 'none' as const,
  }));

const standardSubscription = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Standard',
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400 * 30,
    currentPeriodStart: Math.floor(Date.now() / 1000) - 86_400 * 30,
    cancelAtPeriodEnd: false,
    status: 'active' as const,
  }));

const proSubscription = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Pro',
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400 * 30,
    currentPeriodStart: Math.floor(Date.now() / 1000) - 86_400 * 30,
    cancelAtPeriodEnd: false,
    status: 'active' as const,
  }));

describe('PricingPage', () => {
  beforeEach(() => {
    setAuth({ signedIn: false });
  });

  it('all buttons show sign-in variants when logged out (no subscription fetched)', () => {
    // Unauthenticated — subscription query is disabled; signin variant buttons render immediately
    renderWithProviders(<PricingPage />);

    // Basic shows "Login to Start"; paid plans show "Choose <Name>"
    expect(
      screen.getByRole('button', { name: /login to start/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose standard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose pro/i }),
    ).toBeInTheDocument();
  });

  it('disables the current plan button for a Standard subscriber', async () => {
    setAuth({ signedIn: true });
    server.use(standardSubscription());

    renderWithProviders(<PricingPage />);

    const currentPlanButton = await screen.findByRole('button', {
      name: /current plan/i,
    });
    expect(currentPlanButton).toBeDisabled();
  });

  it('prevents downgrade to Basic from a paid plan (button disabled)', async () => {
    setAuth({ signedIn: true });
    server.use(standardSubscription());

    renderWithProviders(<PricingPage />);

    const downgradeButton = await screen.findByRole('button', {
      name: /downgrade to basic/i,
    });
    expect(downgradeButton).toBeDisabled();
  });

  it('shows Upgrade to Pro button enabled when on Standard', async () => {
    setAuth({ signedIn: true });
    server.use(standardSubscription());

    renderWithProviders(<PricingPage />);

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to pro/i,
    });
    expect(upgradeButton).toBeEnabled();
  });

  it('shows Downgrade to Standard button enabled when on Pro', async () => {
    setAuth({ signedIn: true });
    server.use(proSubscription());

    renderWithProviders(<PricingPage />);

    const downgradeButton = await screen.findByRole('button', {
      name: /downgrade to standard/i,
    });
    expect(downgradeButton).toBeEnabled();
  });

  it('shows processing state on clicked button after checkout mutation fires', async () => {
    setAuth({ signedIn: true });
    server.use(
      basicSubscription(),
      // Never-resolving mutation keeps the button in processing state
      trpcMsw.account.createCheckoutSession.mutation(
        () =>
          new Promise<never>(() => {
            /* stays pending */
          }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<PricingPage />);

    const chooseStandard = await screen.findByRole('button', {
      name: /choose standard/i,
    });
    await user.click(chooseStandard);

    // Button becomes processing — shows "Processing..." text and is disabled
    await waitFor(() => {
      expect(chooseStandard).toBeDisabled();
    });
    expect(chooseStandard).toHaveTextContent(/processing/i);
  });

  it('shows redirect toast after checkout succeeds and navigates', async () => {
    setAuth({ signedIn: true });
    server.use(
      basicSubscription(),
      trpcMsw.account.createCheckoutSession.mutation(() => ({
        checkoutTimestamp: Date.now(),
        customerId: 'cus_test',
        customerEmail: 'user@test.dev',
        isReturningCustomer: false,
        sessionId: 'sess_test',
        checkoutUrl: 'https://stripe.test/checkout/session',
      })),
    );

    const user = userEvent.setup();
    renderWithProviders(<PricingPage />);

    const chooseStandard = await screen.findByRole('button', {
      name: /choose standard/i,
    });
    await user.click(chooseStandard);

    // Observable outcome: a toast appears confirming redirect
    expect(
      await screen.findByText(/redirecting to checkout/i),
    ).toBeInTheDocument();
  });

  it('shows redirect toast after dashboard session succeeds for existing subscriber', async () => {
    setAuth({ signedIn: true });
    server.use(
      standardSubscription(),
      trpcMsw.account.createDashboardSession.mutation(() => ({
        success: true,
        billingPortalUrl: 'https://stripe.test/billing-portal',
        message: 'ok',
      })),
    );

    const user = userEvent.setup();
    renderWithProviders(<PricingPage />);

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to pro/i,
    });
    await user.click(upgradeButton);

    expect(
      await screen.findByText(/redirecting to stripe dashboard/i),
    ).toBeInTheDocument();
  });
});
