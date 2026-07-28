'use client';

import { useBillingRedirect } from './use-billing-redirect';

/**
 * The Checkout/portal seam a viewer can trigger from the UI: creating a Checkout
 * session (new Subscription) or a Billing portal session (manage an existing
 * one). Composes the Billing redirect module (use-billing-redirect.ts), which
 * owns the create-session → redirect-URL → navigate flow, the loading toast, and
 * the typed billing-error → toast mapping. `SubscriptionCancellation` reaches the
 * Billing portal through `openBillingPortal`.
 */
export function useCheckout() {
  const { checkout, openBillingPortal, isPending } = useBillingRedirect();
  return { checkout, openBillingPortal, isPending };
}
