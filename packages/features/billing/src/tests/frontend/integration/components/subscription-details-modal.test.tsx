/**
 * SubscriptionDetailsModal — integration/components (ADR 0018).
 *
 * The modal is fed subscriptionData via props (no hook/network of its own).
 * The child SubscriptionCancellation renders real — it uses useCheckout which
 * calls useTRPC, so we register a createDashboardSession handler for tests
 * that render a paid plan (Basic hides the child). Assert the modal's own DOM.
 */
import { screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import type { SubscriptionDetails } from '../../../../components/subscription-details-modal';
import { SubscriptionDetailsModal } from '../../../../components/subscription-details-modal';
import { renderWithProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// A handler for createDashboardSession — needed whenever SubscriptionCancellation
// renders (i.e. when subscription !== 'Basic'), even if we don't click the button.
// The component only fires the mutation on click; the handler is registered
// preemptively because onUnhandledRequest:'error' would trip on any accidental call.
const dashboardHandler = trpcMsw.account.createDashboardSession.mutation(
  () => ({
    success: true,
    billingPortalUrl: 'https://stripe.test/billing-portal',
    message: 'ok',
  }),
);

function handleOpenChange() {
  // Intentionally empty
}

describe('SubscriptionDetailsModal', () => {
  it('renders error state when no subscription data', async () => {
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={undefined}
      />,
    );
    expect(
      await screen.findByText(/unable to load details/i),
    ).toBeInTheDocument();
  });

  it('shows plan, status badges and Free Plan notice for Basic', async () => {
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={{
          subscription: 'Basic',
          currentPeriodEnd: null,
          currentPeriodStart: null,
          cancelAtPeriodEnd: false,
          status: 'none',
        }}
      />,
    );

    const basicMatches = await screen.findAllByText(/basic/i);
    expect(basicMatches.length).toBeGreaterThan(0);
    const noneMatches = screen.getAllByText(/none/i);
    expect(noneMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/free plan/i)).toBeInTheDocument();
  });

  it('shows auto-renewal active for paid active plan', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    const sub: SubscriptionDetails = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
      />,
    );

    expect(await screen.findByText(/standard/i)).toBeInTheDocument();
    const activeMatches = screen.getAllByText(/active/i);
    expect(activeMatches.length).toBeGreaterThan(1);
    expect(screen.getByText(/auto-renewal active/i)).toBeInTheDocument();
    expect(screen.getByText(/next renewal date/i)).toBeInTheDocument();
  });

  it('shows cancellation date when cancelAtPeriodEnd true', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 10;
    const sub: SubscriptionDetails = {
      subscription: 'Pro',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: true,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
      />,
    );

    expect(await screen.findByText(/pro/i)).toBeInTheDocument();
    expect(screen.getByText(/cancellation date/i)).toBeInTheDocument();
    expect(screen.queryByText(/auto-renewal active/i)).not.toBeInTheDocument();
  });

  it('renders reactivate button for cancelled paid plan', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 5;
    const sub: SubscriptionDetails = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: true,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
      />,
    );

    expect(
      await screen.findByRole('button', { name: /reactivate subscription/i }),
    ).toBeInTheDocument();
  });

  it('shows token usage section and correct numbers for paid plan', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    const sub: SubscriptionDetails = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 60,
          limit: 100,
          resetAt: future,
          usagePercentage: 40,
        }}
      />,
    );

    const section = await screen.findByTestId('credit-usage-section');
    expect(section).toBeInTheDocument();
    expect(screen.getByText(/used/i)).toBeInTheDocument();
    expect(screen.getByText(/40 \/ 100/i)).toBeInTheDocument();
    expect(screen.getByText(/60 credits remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/resets/i)).toBeInTheDocument();
  });

  it('progress bar width reflects usage percentage', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    const sub: SubscriptionDetails = {
      subscription: 'Pro',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 10,
          limit: 100,
          resetAt: future,
          usagePercentage: 90,
        }}
      />,
    );

    const progress = await screen.findByTestId('credit-usage-progress');
    expect(progress).toHaveStyle({ width: '90%' });
  });

  it('progress bar uses color thresholds', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    const sub: SubscriptionDetails = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };

    // Low usage => green
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 50,
          limit: 100,
          resetAt: future,
          usagePercentage: 50,
        }}
      />,
    );
    {
      const progresses = await screen.findAllByTestId('credit-usage-progress');
      expect(progresses.at(-1)?.className).toMatch(/bg-green-600/);
    }

    // Medium usage => yellow
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 25,
          limit: 100,
          resetAt: future,
          usagePercentage: 75,
        }}
      />,
    );
    {
      const progresses = await screen.findAllByTestId('credit-usage-progress');
      expect(progresses.at(-1)?.className).toMatch(/bg-yellow-600/);
    }

    // High usage => red
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 5,
          limit: 100,
          resetAt: future,
          usagePercentage: 95,
        }}
      />,
    );
    {
      const progresses = await screen.findAllByTestId('credit-usage-progress');
      expect(progresses.at(-1)?.className).toMatch(/bg-red-600/);
    }
  });

  it('shows zero remaining credits alert', async () => {
    server.use(dashboardHandler);
    const future = Math.floor(Date.now() / 1000) + 86_400 * 7;
    const sub: SubscriptionDetails = {
      subscription: 'Pro',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };

    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={sub}
        creditUsageData={{
          remaining: 0,
          limit: 100,
          resetAt: future,
          usagePercentage: 100,
        }}
      />,
    );

    expect(
      await screen.findByText(/no credits remaining/i),
    ).toBeInTheDocument();
  });
});
