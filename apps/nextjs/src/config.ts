import { isServer } from '@tanstack/react-query';

import { authConfig } from '@acme/auth/config';
import { configExtends } from '@acme/config';

import { appEnv } from './env';

/**
 * The app's config composition edge (ADR 0026), mirroring `env.ts`'s
 * `extends: [...]`: resolve the injected context once — `appEnv` from `env.ts`,
 * `isServer` from the runtime — and thread it into every slice's config factory.
 * Consumed by `<ClerkProvider>` in the root layout.
 */
const context = { appEnv, isServer };

export const config = configExtends([authConfig(context)]);
