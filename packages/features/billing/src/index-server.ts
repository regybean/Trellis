import 'server-only';

// Framework-neutral server surface: the tRPC router/context, the Stripe
// webhook helpers and the KV sync used by both apps. No `next` imports here, so
// it is safe to mount under TanStack Start / Nitro as well as Next.js.
export {
  processEvent,
  tryCatch,
  getStripe,
  syncStripeDataToKV,
} from './utils/stripe';
export { appRouter } from './api/root';
export { createTRPCContext } from './api/trpc';
