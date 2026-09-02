import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AppQueryClientProvider,
  AuthStatusProvider,
  resolvedAuthStatus,
} from '@acme/hooks';

import { NotificationsProvider } from '../../../../index';
import { shouldTailNotifications } from '../../../../notifications-provider';

// `notifications.stream` is a `protectedProcedure`, so subscribing while signed
// out earns an UNAUTHORIZED that tRPC then retries — a burst of error-level
// server logs for a denial that was never actionable. `shouldTailNotifications`
// is the gate.
//
// It is asserted directly, and deliberately NOT at the HTTP boundary this suite
// otherwise prefers (ADR 0018). The SSE transport never connects under jsdom, so
// no request is made whether the tail is enabled or not: an "assert no request
// was sent" test passes identically against the fixed and the unfixed component,
// which is the definition of a test that cannot fail. Verified by breaking the
// gate on purpose and confirming the assertions below go red.

describe('notifications auth gate', () => {
  it('tails once the viewer is signed in', () => {
    expect(shouldTailNotifications(resolvedAuthStatus('user-1'))).toBe(true);
  });

  it('tails in an app with no auth provider', () => {
    // The slim apps mount this provider with no `AuthStatusProvider` and inject
    // a synthetic session server-side (ADR 0010), so an absent provider means
    // "always authorized" — it must NOT read as signed-out and go dark.
    expect(shouldTailNotifications(null)).toBe(true);
  });

  it('withholds the tail while the viewer is signed out', () => {
    expect(shouldTailNotifications(resolvedAuthStatus(null))).toBe(false);
  });

  it('withholds the tail until the session has resolved', () => {
    // `isLoaded: false` is the first client render, session not yet known.
    // Firing here would 401 on every page load, signed in or not.
    expect(
      shouldTailNotifications({
        isLoaded: false,
        isSignedIn: false,
        userId: null,
      }),
    ).toBe(false);
  });

  it('still renders its children when the tail is withheld', async () => {
    // The gate must suppress only the subscription. A signed-out viewer still
    // gets the provider and everything under it.
    render(
      <AppQueryClientProvider>
        <AuthStatusProvider status={resolvedAuthStatus(null)}>
          <NotificationsProvider>
            <div data-testid="child" />
          </NotificationsProvider>
        </AuthStatusProvider>
      </AppQueryClientProvider>,
    );

    expect(await screen.findByTestId('child')).toBeInTheDocument();
  });
});
