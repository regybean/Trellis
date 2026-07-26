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
 * Clerk *secrets* (secret key, webhook signing secret) and the publishable key
 * stay in `process.env`. The app threads these into its `<ClerkProvider>`
 * (`signInUrl` etc.) at the composition edge; the Clerk SDK no longer reads them
 * implicitly from env.
 */
export function authConfig(context: ConfigContext) {
  return createConfig({
    client: {
      CLERK_SIGN_IN_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_URL: z.string().startsWith('/'),
      CLERK_SIGN_IN_FORCE_REDIRECT_URL: z.string().startsWith('/'),
      CLERK_SIGN_UP_FORCE_REDIRECT_URL: z.string().startsWith('/'),
    },
    profiles: {
      default: {
        client: {
          CLERK_SIGN_IN_URL: '/sign-in',
          CLERK_SIGN_UP_URL: '/sign-up',
          CLERK_SIGN_IN_FORCE_REDIRECT_URL: '/',
          CLERK_SIGN_UP_FORCE_REDIRECT_URL: '/',
        },
      },
    },
    context,
  });
}
