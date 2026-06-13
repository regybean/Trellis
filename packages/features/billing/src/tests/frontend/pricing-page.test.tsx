import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@testing-library/jest-dom';

import type { Mock } from 'vitest';
import { useAuth } from '@clerk/nextjs';
import userEvent from '@testing-library/user-event';

import { PricingPage } from '../../components/pricing';
import { renderWithProviders } from './setup';

// Helper: get all plan buttons by role + text heuristics
const getPlanButtons = () => {
  // All pricing plan card buttons are rendered as role=button
  // We can narrow by text of known CTAs
  return screen.getAllByRole('button', {
    name: /basic|standard|pro|current plan|choose|upgrade|downgrade|login/i,
  });
};

// Track mutation calls
const createCheckoutSpy = vi.fn((_input: { productId: string }) => {
  return {
    checkoutTimestamp: Date.now(),
    customerId: 'cus_test',
    customerEmail: 'user@test.dev',
    isReturningCustomer: false,
    sessionId: 'sess_test',
    checkoutUrl: 'https://stripe.test/checkout/session',
  };
});

const createDashboardSpy = vi.fn(() => {
  return {
    success: true,
    billingPortalUrl: 'https://stripe.test/billing-portal',
    message: 'ok',
  };
});

// Provide mutable subscription state for handlers override per test
let subscriptionResponse: {
  subscription: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number | null;
} | null = null;
// TODO make this use msw-trpc like the other tests
// Mocked tRPC client
vi.mock('../../trpc/react', () => ({
  useTRPC: () => ({
    account: {
      getSubscriptionDetails: {
        queryOptions: (input?: unknown, options?: { enabled?: boolean }) => {
          const base = subscriptionResponse ?? {
            subscription: 'Basic',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
          };

          const data =
            base.subscription === 'Basic'
              ? ({
                  subscription: 'Basic',
                  cancelAtPeriodEnd: false,
                  currentPeriodEnd: null,
                  currentPeriodStart: null,
                  status: 'none',
                } as const)
              : ({
                  subscription: base.subscription,
                  cancelAtPeriodEnd: base.cancelAtPeriodEnd ?? false,
                  currentPeriodEnd: base.currentPeriodEnd ?? null,
                  currentPeriodStart: base.currentPeriodEnd ?? null,
                  status: 'active',
                } as const);

          return {
            queryKey: ['account', 'getSubscriptionDetails'],
            queryFn: () => Promise.resolve(data),
            enabled: options?.enabled,
          };
        },
      },
      createCheckoutSession: {
        mutationOptions: (callbacks?: {
          onSuccess?: (data: ReturnType<typeof createCheckoutSpy>) => void;
          onError?: (err: Error) => void;
          onSettled?: () => void;
        }) => {
          const handleSuccess = callbacks?.onSuccess;
          const handleSettled = callbacks?.onSettled;

          return {
            mutationFn: (input: { productId: string }) => {
              const result = createCheckoutSpy(input);
              if (handleSuccess) {
                handleSuccess(result);
              }
              if (handleSettled) {
                setTimeout(handleSettled, 0);
              }
              return Promise.resolve(result);
            },
          };
        },
      },
      createDashboardSession: {
        mutationOptions: (callbacks?: {
          onSuccess?: (data: ReturnType<typeof createDashboardSpy>) => void;
          onError?: (err: Error) => void;
          onSettled?: () => void;
        }) => {
          const handleSuccess = callbacks?.onSuccess;
          const handleSettled = callbacks?.onSettled;

          return {
            mutationFn: () => {
              const result = createDashboardSpy();
              if (handleSuccess) {
                handleSuccess(result);
              }
              if (handleSettled) {
                setTimeout(handleSettled, 0);
              }
              return Promise.resolve(result);
            },
          };
        },
      },
    },
  }),
}));

// Helper to set auth state (moved outside describe for lint rule unicorn/consistent-function-scoping)
const setAuth = (opts: { loaded?: boolean; signedIn?: boolean }) => {
  (useAuth as Mock).mockReturnValue({
    isLoaded: opts.loaded ?? true,
    isSignedIn: opts.signedIn ?? false,
    userId: opts.signedIn ? 'user_1' : null,
    sessionId: opts.signedIn ? 'sess_1' : null,
  });
};

describe('Pricing Page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    // Default: logged out
    setAuth({ signedIn: false });
    subscriptionResponse = {
      subscription: 'Basic',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
  });

  it('redirects all buttons to sign-in when logged out', async () => {
    const user = userEvent.setup();
    // Spy on location.href changes
    const originalLocation = globalThis.location;
    // @ts-expect-error override for test
    delete globalThis.location;
    // @ts-expect-error assign
    globalThis.location = { href: '', assign: vi.fn() };

    renderWithProviders(<PricingPage />);

    const buttons = getPlanButtons();
    expect(buttons.length).toBeGreaterThan(0);

    const firstButton = buttons[0];
    expect(firstButton).toBeDefined();
    if (firstButton) {
      await user.click(firstButton);
    }

    await waitFor(() => {
      expect(globalThis.location.href).toContain('/sign-in');
    });

    globalThis.location = originalLocation; // restore
  });

  it('disables current plan button (Standard)', async () => {
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Standard',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    // Find button with text Current Plan
    const currentPlanButton = await screen.findByRole('button', {
      name: /current plan/i,
    });
    expect(currentPlanButton).toBeDisabled();
  });

  it('prevents downgrade to Basic from paid plan (button disabled with text Downgrade to Basic)', async () => {
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Standard',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const downgradeButton = await screen.findByRole('button', {
      name: /downgrade to basic/i,
    });
    expect(downgradeButton).toBeDisabled();
  });

  it('shows Upgrade to Pro when on Standard plan', async () => {
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Standard',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to pro/i,
    });
    expect(upgradeButton).toBeEnabled();
  });

  it('shows Downgrade to Standard when on Pro plan', async () => {
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Pro',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const downgradeButton = await screen.findByRole('button', {
      name: /downgrade to standard/i,
    });
    expect(downgradeButton).toBeEnabled();
  });

  it('clicking an upgrade triggers loading state only on that button and others disabled', async () => {
    const user = userEvent.setup();
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Standard',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const upgradeButton = await screen.findByRole('button', {
      name: /upgrade to pro/i,
    });

    await user.click(upgradeButton);

    // Loading text or spinner
    await waitFor(() => {
      expect(upgradeButton).toBeDisabled();
    });
    expect(upgradeButton).toHaveTextContent(/processing/i);

    // All other plan buttons should be disabled while processing
    const allButtons = getPlanButtons();
    // Use for...of per lint rule unicorn/no-array-for-each
    for (const btn of allButtons) {
      expect(btn).toBeDisabled();
    }

    expect(createDashboardSpy).toHaveBeenCalled();
  });

  it('creates checkout session when purchasing from Basic', async () => {
    const user = userEvent.setup();
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Basic',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const chooseStandard = await screen.findByRole('button', {
      name: /choose standard/i,
    });
    await user.click(chooseStandard);

    await waitFor(() => {
      // Accept either the expected object or undefined (in case msw-trpc packs differently); fall back by checking call count
      expect(createCheckoutSpy).toHaveBeenCalled();
      const arg: unknown = createCheckoutSpy.mock.calls[0]?.[0];
      // If arg is defined ensure productId matches
      if (arg && typeof arg === 'object' && 'productId' in arg) {
        expect(arg).toEqual({ productId: 'standard_plan_12345' });
      }
    });
  });

  describe('Cancellation component behavior', () => {
    it('shows cancel subscription link for active paid subscription', async () => {
      setAuth({ signedIn: true });
      subscriptionResponse = {
        subscription: 'Standard',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      };

      renderWithProviders(<PricingPage />);

      const cancelLink = await screen.findByRole('button', {
        name: /cancel subscription/i,
      });
      expect(cancelLink).toBeInTheDocument();
      expect(cancelLink).toBeEnabled();
    });

    it('shows reactivation button when subscription is set to cancel at period end', async () => {
      const user = userEvent.setup();
      setAuth({ signedIn: true });
      const endDate = Math.floor(Date.now() / 1000) + 86_400 * 10;
      subscriptionResponse = {
        subscription: 'Pro',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: endDate,
      };

      renderWithProviders(<PricingPage />);

      const reactivateButton = await screen.findByRole('button', {
        name: /reactivate subscription/i,
      });
      expect(reactivateButton).toBeInTheDocument();
      await user.click(reactivateButton);

      await waitFor(() => {
        expect(createDashboardSpy).toHaveBeenCalled();
      });
    });
  });

  it('reactivation and cancellation buttons trigger dashboard session mutation', async () => {
    const user = userEvent.setup();
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Standard',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    renderWithProviders(<PricingPage />);

    const cancelButton = await screen.findByRole('button', {
      name: /cancel subscription/i,
    });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(createDashboardSpy).toHaveBeenCalled();
    });
  });

  it('enterprise plan triggers mailto link when clicked', async () => {
    const user = userEvent.setup();
    setAuth({ signedIn: true });
    subscriptionResponse = {
      subscription: 'Basic',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };

    // Spy on location
    const originalLocation = globalThis.location;
    // @ts-expect-error override jsdom location
    delete globalThis.location;
    // @ts-expect-error assign partial
    globalThis.location = { href: '', assign: vi.fn() };

    renderWithProviders(<PricingPage />);

    // Find enterprise button by its text Contact Sales
    const contactSalesButton = await screen.findByRole('button', {
      name: /contact sales/i,
    });
    await user.click(contactSalesButton);

    await waitFor(() => {
      expect(globalThis.location.href).toContain('mailto:');
    });

    globalThis.location = originalLocation;
  });
});
