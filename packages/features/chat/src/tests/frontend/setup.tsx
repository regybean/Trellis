import type { RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createRef, useState } from 'react';
import { render } from '@testing-library/react';
import { createTRPCMsw, httpLink as mswHttpLink } from 'msw-trpc';
import superjson from 'superjson';
import { vi } from 'vitest';

import type { AppRouter } from '../../api/root';
import type { Message } from '../../api/schemas/message-schema';
import { TRPCReactProvider } from '../../trpc/react';

// Mock the useChat hook to spy on the send function
export const mockSend = vi.fn();
export const mockMessages: Message[] = [
  {
    text: 'I am an interactive AI chat assistant ready to answer questions about OT cybersecurity in the rail sector, how may I help you today?',
    role: 'assistant',
  },
];
vi.mock('../../hooks/use-chat', () => {
  // Return a hook implementation that uses React state so `send` triggers a re-render
  return {
    useChat: vi.fn(() => {
      const [messages, setMessages] = useState<Message[]>(mockMessages);

      return {
        messages,
        isLoading: false,
        send: (text: string) => {
          mockSend(text);
          setMessages((prev: Message[]) => [
            ...prev,
            {
              text,
              role: 'user',
            },
          ]);
        },
        shouldScrollToBottom: false,
        setShouldScrollToBottom: vi.fn(),
        scrollToBottomRef: createRef(),
      };
    }),
  };
});

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
      url: 'http://localhost:3000/api/trpc/chat',
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
