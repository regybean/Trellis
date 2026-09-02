import { act, render, screen } from '@testing-library/react';
import { toast, ToastContainer } from 'react-toastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppQueryClientProvider } from '@acme/hooks';

import type { Notification, NotificationRenderers } from '../../../../index';
import { dispatchNotification, NotificationsProvider } from '../../../../index';

// The dispatch → toast contract, asserted through a real `<ToastContainer />`
// (ADR 0018). Dispatch is factored as an independently-callable function, so we
// drive it directly with synthetic envelopes — the un-drivable SSE tail (mounted
// by the provider) stays out of the way.

const envelope = (over: Partial<Notification> = {}): Notification => ({
  id: 'n-1',
  kind: 'plain',
  level: 'info',
  message: 'hello',
  createdAt: '2026-07-31T12:00:00.000Z',
  ...over,
});

// The app's single QueryClient wraps the provider (ADR 0036): the notifications
// provider renders none of its own, so mounting it needs one exactly as an app
// supplies one.
function renderHarness(renderers?: NotificationRenderers) {
  return render(
    <AppQueryClientProvider>
      <NotificationsProvider renderers={renderers}>
        <div data-testid="child" />
      </NotificationsProvider>
      <ToastContainer />
    </AppQueryClientProvider>,
  );
}

describe('notification dispatch', () => {
  it('renders an unregistered kind via the default toast at the mapped level', async () => {
    renderHarness({});

    act(() =>
      dispatchNotification(envelope({ level: 'error', message: 'it broke' })),
    );

    expect(await screen.findByText('it broke')).toBeInTheDocument();
    // level → toast.error maps to react-toastify's error variant.
    expect(document.querySelector('.Toastify__toast--error')).not.toBeNull();
  });

  it('lets a registered kind win over the default renderer', async () => {
    // A custom renderer zod-parses its own opaque `data` and composes its own
    // toast — the core never ships feature renderers (ADR 0030).
    const renderers: NotificationRenderers = {
      'ingest.job-complete': (n) => {
        const { total } = z.object({ total: z.number() }).parse(n.data);
        toast(`indexed ${total}`);
      },
    };
    renderHarness(renderers);

    act(() =>
      dispatchNotification(
        envelope({
          kind: 'ingest.job-complete',
          message: 'ignored by custom renderer',
          data: { total: 7 },
        }),
        renderers,
      ),
    );

    expect(await screen.findByText('indexed 7')).toBeInTheDocument();
    // The default renderer's message must NOT appear — the custom one won.
    expect(screen.queryByText('ignored by custom renderer')).toBeNull();
  });

  it('collapses a duplicate id to a single toast (toastId dedup)', async () => {
    renderHarness();

    const dup = envelope({ id: 'dup', message: 'only once' });
    act(() => dispatchNotification(dup));
    act(() => dispatchNotification(dup));

    expect(await screen.findByText('only once')).toBeInTheDocument();
    expect(screen.getAllByText('only once')).toHaveLength(1);
  });
});
