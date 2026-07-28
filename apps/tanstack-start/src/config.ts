import { authConfig } from '@acme/auth/config';
import { billingConfig } from '@acme/billing/config';
import { configExtends, isServer } from '@acme/config';

import { appEnv } from './env';

/**
 * The app's config composition edge (ADR 0026), mirroring `env.ts`'s
 * `extends: [...]`: resolve the injected context once — `appEnv` from `env.ts`,
 * `isServer` from the runtime — and thread it into every slice's config factory.
 * Consumed by `<ClerkProvider>` + `<BillingConfigProvider>` in the root route,
 * and by the entitlements provider injected in `lib/clerk-context.ts`.
 */
const context = { appEnv, isServer };

export const config = configExtends([
  authConfig(context),
  billingConfig(context),
]);
