import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from './setup';

import '@testing-library/jest-dom';

import type { SubscriptionDetails } from '../../components/subscription-details-modal';
import { SubscriptionDetailsModal } from '../../components/subscription-details-modal';

// Both of these mocks need to be in this file as their values mess with the existing mocks in setup.tsx
// Mock child component SubscriptionCancellation to isolate modal behaviour & capture props
vi.mock('../../components/stripe/stripe-cancellation', () => ({
  SubscriptionCancellation: vi.fn((props) => {
    return (
      <div
        data-testid="subscription-cancellation"
        data-props={JSON.stringify(props)}
      >
        SubscriptionCancellation Mock
      </div>
    );
  }),
}));

// We also mock Clerk's useAuth because Header & other components rely on it when used, though here we only rely on query enabling logic.
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

// Use shared exported interface from component for single source of truth.
// Control the subscription response dynamically (null represents reset; undefined => error/no data path)
let subscriptionResponse: SubscriptionDetails | null | undefined = null;

// onOpenChange handler placeholder extracted to top-level for lint compliance
function handleOpenChange() {
  // Intentionally empty
}

describe('SubscriptionDetailsModal', () => {
  afterEach(() => {
    subscriptionResponse = null;
  });

  const renderModal = (open = true) => {
    return renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={open}
        onOpenChange={handleOpenChange}
        subscriptionData={subscriptionResponse ?? undefined}
      />,
    );
  };

  it('renders error state when no subscription data', async () => {
    subscriptionResponse = undefined; // explicit no data path
    renderModal();
    expect(
      await screen.findByText(/unable to load details/i),
    ).toBeInTheDocument();
  });

  it('shows plan, status badges and Free Plan notice for Basic', async () => {
    subscriptionResponse = {
      subscription: 'Basic',
      currentPeriodEnd: null,
      currentPeriodStart: null,
      cancelAtPeriodEnd: false,
      status: 'none',
    };
    renderModal();

    // Multiple occurrences of Basic (badge + message); ensure at least one badge present
    const basicMatches = await screen.findAllByText(/basic/i);
    expect(basicMatches.length).toBeGreaterThan(0);
    // Status badge 'None' (case-insensitive)
    const noneMatches = screen.getAllByText(/none/i);
    expect(noneMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/free plan/i)).toBeInTheDocument();
    // Access mock directly from vi module registry
    const importedModule =
      await import('../../components/stripe/stripe-cancellation');
    const cancellationMock = vi.mocked(importedModule.SubscriptionCancellation);
    // Ensure mock invoked
    expect(cancellationMock).toBeDefined();
    const mockNode = screen.getByTestId('subscription-cancellation');
    const propsRaw = mockNode.dataset.props ?? '';
    expect(propsRaw).toContain('"subscriptionType":"Basic"');
  });

  it('shows auto-renewal active for paid active plan', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    subscriptionResponse = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: false,
      status: 'active',
    };
    renderModal();

    expect(await screen.findByText(/standard/i)).toBeInTheDocument();
    // 'Active' appears in both status badge and 'Auto-Renewal Active'; assert at least one status occurrence
    const activeMatches = screen.getAllByText(/active/i);
    expect(activeMatches.length).toBeGreaterThan(1); // badge + message
    expect(screen.getByText(/auto-renewal active/i)).toBeInTheDocument();
    expect(screen.getByText(/next renewal date/i)).toBeInTheDocument();
  });

  it('shows cancellation date when cancelAtPeriodEnd true', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400 * 10;
    subscriptionResponse = {
      subscription: 'Pro',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: true,
      status: 'active',
    };
    renderModal();

    expect(await screen.findByText(/pro/i)).toBeInTheDocument();
    expect(screen.getByText(/cancellation date/i)).toBeInTheDocument();
    // Auto-Renewal message should not appear
    expect(screen.queryByText(/auto-renewal active/i)).not.toBeInTheDocument();
  });

  it('passes correct props to SubscriptionCancellation component', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400 * 5;
    subscriptionResponse = {
      subscription: 'Standard',
      currentPeriodEnd: future,
      currentPeriodStart: future - 86_400 * 30,
      cancelAtPeriodEnd: true,
      status: 'active',
    };
    renderModal();

    const mockNode = await screen.findByTestId('subscription-cancellation');
    const raw = mockNode.dataset.props ?? '{}';
    interface CancellationPropsShape {
      subscriptionType?: string;
      isCancelledAtPeriodEnd?: boolean;
      currentPeriodEnd?: number | null;
    }
    const props = JSON.parse(raw) as CancellationPropsShape;
    expect(props.subscriptionType).toBe('Standard');
    expect(props.isCancelledAtPeriodEnd).toBe(true);
    expect(props.currentPeriodEnd).toBe(future);
  });

  it('shows token usage section and correct numbers for paid plan', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    subscriptionResponse = {
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
        subscriptionData={subscriptionResponse}
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
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    subscriptionResponse = {
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
        subscriptionData={subscriptionResponse}
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
    const future = Math.floor(Date.now() / 1000) + 86_400 * 30;
    subscriptionResponse = {
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
        subscriptionData={subscriptionResponse}
        creditUsageData={{
          remaining: 50,
          limit: 100,
          resetAt: future,
          usagePercentage: 50,
        }}
      />,
    );

    // Low usage => green
    const initialProgresses = await screen.findAllByTestId(
      'credit-usage-progress',
    );
    const progressInitial = initialProgresses.at(-1);
    expect(progressInitial?.className).toMatch(/bg-green-600/);

    // Medium usage => yellow
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={subscriptionResponse}
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
      const progressMid = progresses.at(-1);
      expect(progressMid?.className).toMatch(/bg-yellow-600/);
    }

    // High usage => red
    renderWithProviders(
      <SubscriptionDetailsModal
        isOpen={true}
        onOpenChange={handleOpenChange}
        subscriptionData={subscriptionResponse}
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
      const progressHigh = progresses.at(-1);
      expect(progressHigh?.className).toMatch(/bg-red-600/);
    }
  });

  it('shows zero remaining credits alert', async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400 * 7;
    subscriptionResponse = {
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
        subscriptionData={subscriptionResponse}
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
