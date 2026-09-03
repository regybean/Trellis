'use client';

import { createContext, useContext } from 'react';

/**
 * The client-readable billing values (@acme/env ADR 0001): the four Stripe keys this
 * slice's env declares `shared`. The app narrows its env at the edge
 * (`toBillingClientConfig`) and threads them in here — feature runtime never reads
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
 * on the server from `env.STRIPE_CONNECTION` (@acme/env ADR 0001) and threaded
 * here so the client reads one value instead of proxying the condition through
 * `NODE_ENV`.
 */
export interface BillingClientConfig extends BillingConfigValues {
  localstripeMode: boolean;
}

const BillingConfigContext = createContext<BillingClientConfig | null>(null);

/**
 * Provide the billing config to the feature's client components/hooks. Mounted
 * at the app edge with this slice's narrowed env values and the server-derived
 * localstripe mode —
 * `<BillingConfigProvider config={config} localstripeMode={localstripeMode}>`.
 * The threaded object is structurally a `BillingConfigValues`; only those four
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
        'Mount it at the app edge with the narrowed billing env (@acme/env ADR 0001).',
    );
  }
  return config;
}
