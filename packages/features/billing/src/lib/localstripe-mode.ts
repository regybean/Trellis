// localstripe mode — the single signal for "are we talking to localstripe
// rather than real Stripe?". Derived once on the server from the STRIPE_API_BASE
// env carve-out (ADR 0003 / ADR 0004): when it is set, `getStripe()` retargets
// the SDK at a fake stateful Stripe server that serves the legacy `plan` shape
// and has no Checkout / Billing-portal API. Pure so both the server branches and
// the config-threaded client read one derived value rather than re-expressing
// the condition (the client previously proxied it through `NODE_ENV`, a leak).

/**
 * `true` when `STRIPE_API_BASE` is a non-empty string (local dev on localstripe);
 * `false` when unset (real Stripe). `STRIPE_API_BASE` stays a `process.env` value
 * (ADR 0026); this only unifies how the condition is read.
 */
export const deriveLocalstripeMode = (stripeApiBase?: string): boolean =>
  stripeApiBase !== undefined && stripeApiBase.length > 0;
