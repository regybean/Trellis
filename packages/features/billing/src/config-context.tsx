'use client';

import { createContext, useContext } from 'react';

/**
 * The client-readable billing config (ADR 0026): the four Stripe values that
 * `billingConfig`'s `client` shape carries. The app resolves the composed config
 * once at its edge and threads it in here — feature runtime never reads
 * `process.env` for these, nor re-resolves `APP_ENV`.
 */
export interface BillingClientConfig {
  STRIPE_STANDARD_PLAN_ID: string;
  STRIPE_PRO_PLAN_ID: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_MANAGE_BILLING_URL: string;
}

const BillingConfigContext = createContext<BillingClientConfig | null>(null);

/**
 * Provide the billing config to the feature's client components/hooks. Mounted
 * at the app edge with the app's composed `config` (from `configExtends`) —
 * `<BillingConfigProvider config={config}>`; the guarded config object is
 * structurally a `BillingClientConfig`, and only its client keys are read here.
 */
export function BillingConfigProvider(props: {
  config: BillingClientConfig;
  children: React.ReactNode;
}) {
  return (
    <BillingConfigContext.Provider value={props.config}>
      {props.children}
    </BillingConfigContext.Provider>
  );
}

/** Read the billing config inside the feature. Throws if the provider is absent. */
export function useBillingConfig(): BillingClientConfig {
  const config = useContext(BillingConfigContext);
  if (!config) {
    throw new Error(
      'useBillingConfig must be used within a <BillingConfigProvider>. ' +
        'Mount it at the app edge with the composed config (ADR 0026).',
    );
  }
  return config;
}
