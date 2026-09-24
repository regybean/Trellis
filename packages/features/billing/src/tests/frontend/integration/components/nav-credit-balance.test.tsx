/**
 * NavCreditBalance — integration/components.
 *
 * The row an app mounts in its signed-in menu. Drive the real component through
 * the real hook and QueryClient with the network faked at the HTTP boundary
 * (MSW), and assert what renders. Auth is the real seam provider, as the app
 * mounts it.
 */
import { screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { NavCreditBalance } from '../../../../components/nav-credit-balance';
import { renderWithProviders, resetAuth, setAuth, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAuth();
});
afterAll(() => server.close());

const subscription = (tier: 'Basic' | 'Standard' | 'Pro') =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: tier,
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
    currentPeriodStart: Math.floor(Date.now() / 1000) - 86_400,
    cancelAtPeriodEnd: false,
    status: 'active' as const,
  }));

const credits = (usage: {
  remaining: number;
  limit: number;
  usagePercentage: number;
}) =>
  trpcMsw.account.getCreditUsage.query(() => ({
    ...usage,
    resetAt: Math.floor(Date.now() / 1000) + 86_400,
  }));

describe('NavCreditBalance', () => {
  beforeEach(() => setAuth({ signedIn: true }));

  it('shows the viewer plan and remaining credits', async () => {
    server.use(
      subscription('Standard'),
      credits({ remaining: 60, limit: 100, usagePercentage: 40 }),
    );

    renderWithProviders(<NavCreditBalance />);

    expect(await screen.findByText('Standard plan')).toBeInTheDocument();
    expect(await screen.findByText('60 / 100')).toBeInTheDocument();
  });

  it('reports credits used as the progress value', async () => {
    server.use(
      subscription('Pro'),
      credits({ remaining: 400, limit: 1600, usagePercentage: 75 }),
    );

    renderWithProviders(<NavCreditBalance />);

    const bar = await screen.findByRole('progressbar', {
      name: 'Credits used',
    });

    expect(bar).toHaveAttribute('aria-valuenow', '75');
  });

  it('clamps a refunded balance rather than reporting negative usage', async () => {
    // `credits.refund` is an uncapped incrBy, so a refunded Generation can push
    // `remaining` past `limit` and the server's percentage below zero.
    server.use(
      subscription('Basic'),
      credits({ remaining: 251, limit: 250, usagePercentage: -1 }),
    );

    renderWithProviders(<NavCreditBalance />);

    const bar = await screen.findByRole('progressbar', {
      name: 'Credits used',
    });

    expect(bar).toHaveAttribute('aria-valuenow', '0');
    // The raw balance is still the truth about the account.
    expect(await screen.findByText('251 / 250')).toBeInTheDocument();
  });

  it('renders nothing when the reads fail', async () => {
    server.use(
      trpcMsw.account.getSubscriptionDetails.query(() => {
        throw new Error('boom');
      }),
      trpcMsw.account.getCreditUsage.query(() => {
        throw new Error('boom');
      }),
    );

    const { container } = renderWithProviders(<NavCreditBalance />);

    // The app's QueryClient carries no `retry` override, so the failure settles
    // only after react-query's three backed-off attempts. The wait is therefore
    // on the skeleton clearing, which is the component's own pending marker.
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-slot="skeleton"]'),
        ).not.toBeInTheDocument(),
      { timeout: 15_000 },
    );

    expect(screen.queryByText(/plan$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  }, 20_000);
});
