import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import '@testing-library/jest-dom';
// jsdom gaps the Radix primitives rely on (ResizeObserver, pointer capture).
import '@acme/test-utils/jsdom';

// Notifications' only frontend contract is the dispatch → toast mapping, driven
// as an independently-callable function (ADR 0018 — the SSE tail isn't drivable
// in jsdom). Tests render `<NotificationsProvider>` (proving it mounts) + a real
// `<ToastContainer />` and invoke `dispatchNotification` with synthetic
// envelopes, asserting the rendered DOM — never a mocked `toast`.
//
// The provider's always-on tail opens a subscription that can't connect in
// jsdom; an empty MSW server with `onUnhandledRequest: 'bypass'` silences that
// attempt so it never fails a test (mirrors chat's frontend suite).
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
