import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Auth config-as-code (ADR 0026). The Clerk sign-in/up route URLs are static,
 * client-side, and identical in every environment — a config-as-code value, not
 * a secret or a per-deploy knob — so they live here as a base-profile-only
 * config instead of being copy-pasted `NEXT_PUBLIC_CLERK_*` rows across every
 * app's `.env.*`. The `NEXT_PUBLIC_` prefix is dropped: it was an env-bundling
 * mechanism, and config bakes at build regardless.
 *
 * The Clerk **publishable key** is a public, per-deploy-target value (it differs
 * per Clerk instance but is safe to embed in the client bundle), so it too is
 * config-as-code with `development | staging | production` profiles — no longer a
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` copy-pasted across every app's `.env.*`.
 * The app threads it into `<ClerkProvider publishableKey>` and
 * `clerkMiddleware({ publishableKey })`; Clerk no longer reads it from env.
 *
 * Clerk *secrets* (secret key, webhook signing secret) stay in `process.env`.
 */
export function authConfig(context: ConfigContext) {
  return createConfig({
    client: {
      CLERK_SIGN_IN_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_URL: z.string().startsWith('/'),
      CLERK_SIGN_IN_FORCE_REDIRECT_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_FORCE_REDIRECT_URL: z.string().startsWith('/'),
      CLERK_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
    },
    profiles: {
      default: {
        client: {
          CLERK_SIGN_IN_URL: '/sign-in',
          CLERK_SIGN_UP_URL: '/sign-up',
          CLERK_SIGN_IN_FORCE_REDIRECT_URL: '/',
          CLERK_SIGN_UP_FORCE_REDIRECT_URL: '/',
          CLERK_PUBLISHABLE_KEY:
            'pk_test_dG9sZXJhbnQtb3J5eC05My5jbGVyay5hY2NvdW50cy5kZXYk',
        },
      },
      staging: {
        client: {
          CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuc3RhZ2luZy5jeXJhaWwuY28udWsk',
        },
      },
      production: {
        client: {
          CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuY3lyYWlsLmNvLnVrJA',
        },
      },
    },
    context,
  });
}
