import type { RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import superjson from 'superjson';
import { vi } from 'vitest';

import type { AppRouter } from '../../api/root';
import { TRPCReactProvider } from '../../trpc/react';

// Mock next/navigation if any internal navigation used (not strictly needed but safe)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock Clerk (now consumed via the neutral @acme/auth surface)
vi.mock('@acme/auth', () => ({
  useAuth: vi.fn(),
}));

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => {
  return render(ui, {
    wrapper: () => <TRPCReactProvider>{ui}</TRPCReactProvider>,
    ...options,
  });
};

export const trpcMsw = createTRPCMsw<AppRouter>({
  links: [
    mswHttpLink({
      url: 'http://localhost:3000/api/trpc/billing',
    }),
  ],
  transformer: { input: superjson, output: superjson },
});

class ResizeObserverMock {
  observe() {
    // Mock implementation - no-op
  }
  unobserve() {
    // Mock implementation - no-op
  }
  disconnect() {
    // Mock implementation - no-op
  }
}

globalThis.ResizeObserver = ResizeObserverMock;

// Radix UI and other libraries may expect these Pointer Events APIs
if (!('hasPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.hasPointerCapture = () => false;
}
if (!('setPointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.setPointerCapture = () => {
    // Mock implementation - no-op
  };
}
if (!('releasePointerCapture' in Element.prototype)) {
  // @ts-expect-error - jsdom doesn't implement this API
  Element.prototype.releasePointerCapture = () => {
    // Mock implementation - no-op
  };
}
