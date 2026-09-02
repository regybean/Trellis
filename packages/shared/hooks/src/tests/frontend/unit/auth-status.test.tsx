/**
 * AuthStatusProvider / useAuthStatus — the client half of the app-owned auth
 * seam (#223, ADR 0003). Asserts observable state through a real render (ADR
 * 0018): what a feature reads back, that it tracks the app's re-render, and that
 * a missing provider fails loudly rather than looking like "signed out". No
 * mocks — the seam has no dependencies to mock.
 */
import type { ReactNode } from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AuthStatus } from '../../../auth-status';
import { AuthStatusProvider, useAuthStatus } from '../../../auth-status';

const SIGNED_IN: AuthStatus = {
  userId: 'user_123',
  isSignedIn: true,
  isLoaded: true,
};
const RESOLVING: AuthStatus = {
  userId: null,
  isSignedIn: false,
  isLoaded: false,
};
const SIGNED_OUT: AuthStatus = {
  userId: null,
  isSignedIn: false,
  isLoaded: true,
};

const wrapperFor = (status: AuthStatus) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <AuthStatusProvider status={status}>{children}</AuthStatusProvider>;
  };

describe('useAuthStatus', () => {
  it('reads back the status the app supplied', () => {
    const { result } = renderHook(() => useAuthStatus(), {
      wrapper: wrapperFor(SIGNED_IN),
    });

    expect(result.current).toEqual(SIGNED_IN);
  });

  it('distinguishes still-resolving from signed-out', () => {
    const resolving = renderHook(() => useAuthStatus(), {
      wrapper: wrapperFor(RESOLVING),
    });
    const signedOut = renderHook(() => useAuthStatus(), {
      wrapper: wrapperFor(SIGNED_OUT),
    });

    // Both are "not signed in", but only one is safe to render a signed-out UI
    // for or to enable a viewer-scoped query against.
    expect(resolving.result.current.isSignedIn).toBe(false);
    expect(resolving.result.current.isLoaded).toBe(false);
    expect(signedOut.result.current.isSignedIn).toBe(false);
    expect(signedOut.result.current.isLoaded).toBe(true);
  });

  it('re-renders a consuming feature when the app resolves the session', () => {
    // A stand-in for the feature components that read the seam: renders the id
    // once signed in, and the loading/anonymous states otherwise.
    function Viewer() {
      const { userId, isSignedIn, isLoaded } = useAuthStatus();
      if (!isLoaded) return <p>Loading…</p>;
      return <p>{isSignedIn ? userId : 'Anonymous'}</p>;
    }

    const { rerender } = render(
      <AuthStatusProvider status={RESOLVING}>
        <Viewer />
      </AuthStatusProvider>,
    );

    expect(screen.getByText('Loading…')).toBeDefined();

    rerender(
      <AuthStatusProvider status={SIGNED_IN}>
        <Viewer />
      </AuthStatusProvider>,
    );

    expect(screen.getByText('user_123')).toBeDefined();
  });

  it('throws without a provider, rather than reporting signed-out', () => {
    expect(() => renderHook(() => useAuthStatus())).toThrow(
      /must be used within an <AuthStatusProvider>/,
    );
  });
});
