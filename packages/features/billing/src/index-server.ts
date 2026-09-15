import 'server-only';

// Framework-neutral server surface: the tRPC router, the Stripe webhook
// helpers and the KV sync used by both apps. No `next` imports here, so it is
// safe to mount under TanStack Start / Nitro as well as Next.js.
export { appRouter } from './api/root';
export { getStripe, localstripeMode } from './api/services/stripe-client';
export { syncStripeDataToKV } from './api/services/stripe-sync';
export { processEvent } from './api/services/stripe-webhook';
export { tryCatch } from './utils/try-catch';
