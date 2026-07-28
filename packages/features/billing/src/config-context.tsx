'use client';

import { createContext, useContext } from 'react';

/**
 * The client-readable billing config values (ADR 0026): the four Stripe values
 * that `billingConfig`'s `client` shape carries. The app resolves the composed
 * config once at its edge and threads it in here — feature runtime never reads
 * `process.env` for these, nor re-resolves `APP_ENV`.
 */
export interface BillingConfigValues {
  STRIPE_STANDARD_PLAN_ID: string;
  STRIPE_PRO_PLAN_ID: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_MANAGE_BILLING_URL: string;
}

/**
 * What the feature reads through the provider: the threaded config values plus
 * `localstripeMode` — the single localstripe-vs-real-Stripe signal, derived once
 * on the server from `stripeConnectionConfig` (ADR 0026 follow-up) and threaded
 * here so the client reads one value instead of proxying the condition through
 * `NODE_ENV`.
 */
export interface BillingClientConfig extends BillingConfigValues {
  localstripeMode: boolean;
}

const BillingConfigContext = createContext<BillingClientConfig | null>(null);

/**
 * Provide the billing config to the feature's client components/hooks. Mounted
 * at the app edge with the app's composed `config` (from `configExtends`) and the
 * server-derived localstripe mode —
 * `<BillingConfigProvider config={config} localstripeMode={localstripeMode}>`.
 * The composed config is structurally a `BillingConfigValues`; only its client
 * keys are read here.
 */
export function BillingConfigProvider(props: {
  config: BillingConfigValues;
  localstripeMode: boolean;
  children: React.ReactNode;
}) {
  const value: BillingClientConfig = {
    STRIPE_STANDARD_PLAN_ID: props.config.STRIPE_STANDARD_PLAN_ID,
    STRIPE_PRO_PLAN_ID: props.config.STRIPE_PRO_PLAN_ID,
    STRIPE_PUBLISHABLE_KEY: props.config.STRIPE_PUBLISHABLE_KEY,
    STRIPE_MANAGE_BILLING_URL: props.config.STRIPE_MANAGE_BILLING_URL,
    localstripeMode: props.localstripeMode,
  };
  return (
    <BillingConfigContext.Provider value={value}>
      {props.children}
    </BillingConfigContext.Provider>
  );
}

/** Read the billing config inside the feature. Throws if the provider is absent. */
export function useBillingConfig() {
  const config = useContext(BillingConfigContext);
  if (!config) {
    throw new Error(
      'useBillingConfig must be used within a <BillingConfigProvider>. ' +
        'Mount it at the app edge with the composed config (ADR 0026).',
    );
  }
  return config;
}
