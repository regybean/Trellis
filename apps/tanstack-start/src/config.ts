import { authConfig } from '@acme/auth/config';
import { billingConfig } from '@acme/billing/config';
import { configExtends } from '@acme/config';

import { configContext } from './env';

/**
 * The app's config composition edge (ADR 0026), mirroring `env.ts`'s
 * `extends: [...]`: thread the one context `env.ts` resolved — deploy target,
 * runtime side, and both override lanes (ADR 0033) — into every slice's config
 * factory. Consumed by `<ClerkProvider>` + `<BillingConfigProvider>` in the root
 * route, and by the entitlements provider injected in `lib/clerk-context.ts`.
 */
export const config = configExtends([
  authConfig(configContext),
  billingConfig(configContext),
]);
