import { cleanup, screen, waitFor } from '@testing-library/react';
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

import { mockSend, renderWithProviders } from './setup';

import '@testing-library/jest-dom';

import { logger } from '@acme/logger';

import { ChatAssistant } from '../../components/chat-assistant';

// Mock scrollIntoView for DOM elements
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  writable: true,
});

// Mock globalThis.scrollTo
Object.defineProperty(globalThis, 'scrollTo', {
  value: vi.fn(),
  writable: true,
});

describe('ChatAssistant', () => {
  const server = setupServer();

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: (req) => {
        logger.info({ method: req.method, url: req.url }, 'Unhandled request');
      },
    });
  });

  afterAll(() => server.close());

  afterEach(() => {
    server.resetHandlers();
    cleanup();
    mockSend.mockClear(); // Clear mock calls between tests
  });

  beforeEach(() => {
    renderWithProviders(<ChatAssistant />);
  });

  it('should display message correctly on valid input', async () => {
    const user = userEvent.setup();
    // Get the input field and send button - use findBy for async rendering
    const inputField = await screen.findByTestId('chat-input');
    const sendButton = await screen.findByTestId('chat-send-button');

    // Get the initial number of messages
    const messageContainer = screen.getByTestId('message-container');
    const initialMessages = messageContainer.querySelectorAll(
      '[data-testid^="message-"]',
    );
    const initialCount = initialMessages.length;

    // Type a valid message
    const testMessage = 'This is a test message';
    await user.type(inputField, testMessage);
    // Send the message
    await user.click(sendButton);
    // Verify a user message was added with our text
    await waitFor(() => {
      // There should be at least one more message than before (user message + potentially loading/bot message)
      const messageContainer = screen.getByTestId('message-container');
      const currentMessages = messageContainer.querySelectorAll(
        '[data-testid^="message-"]',
      );
      expect(currentMessages.length).toBeGreaterThan(initialCount);

      // Check that our message text appears somewhere in the document
      expect(screen.getByText(testMessage)).toBeInTheDocument();
    });
  });

  it('should call streamChat when user presses Enter after typing a message', async () => {
    const user = userEvent.setup();
    // Get the input field
    const inputField = await screen.findByTestId('chat-input');

    // Type a test message
    const testMessage = 'Test message for Enter key';
    await user.type(inputField, testMessage);

    // Simulate pressing Enter
    await user.type(inputField, '{Enter}');

    // Verify that the send function was called with the correct message
    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
    expect(mockSend).toHaveBeenCalledWith(testMessage);
  });
});
