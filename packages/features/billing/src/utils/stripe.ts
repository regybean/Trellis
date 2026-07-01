/**
 * Barrel for the Stripe utilities, split by concern into cohesive modules:
 *
 * - `stripe-client`   — SDK setup (`getStripe`) + shared types
 * - `stripe-checkout` — checkout + billing-portal creation, customer lookup
 * - `stripe-sync`     — KV cache sync (`syncStripeDataToKV`)
 * - `stripe-webhook`  — `allowedEvents` filter + `processEvent`
 * - `stripe-dev`      — localstripe-only admin tooling (`setUserTier`)
 * - `stripe-errors`   — typed `BillingErrorCode` seam (no string coupling)
 * - `try-catch`       — generic error-capturing wrapper
 *
 * Kept as a barrel so existing `../../utils/stripe` imports (and the test mock)
 * stay stable; import the specific module directly in new code.
 */
export type { StripeCustomer, STRIPE_SUB_CACHE } from './stripe-client';
export { getStripe } from './stripe-client';
export {
  createCheckoutSession,
  createDashboardSession,
  findOrCreateCustomer,
  getProductWithPrice,
} from './stripe-checkout';
export { syncStripeDataToKV } from './stripe-sync';
export {
  allowedEvents,
  processEvent,
  resolveWebhookEvent,
} from './stripe-webhook';
export { setUserTier } from './stripe-dev';
export {
  billingError,
  BillingErrorCode,
  toBillingErrorCode,
} from './stripe-errors';
export { tryCatch } from './try-catch';
