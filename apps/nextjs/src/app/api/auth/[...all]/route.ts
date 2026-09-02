import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '~/server/auth';

/**
 * Better Auth's endpoints — sign-up, sign-in, sign-out, get-session and the
 * admin plugin's routes — mounted as one App Router catch-all (#223).
 *
 * The path is `/api/auth/[...all]` because that is Better Auth's default
 * `basePath`, which the browser client also defaults to; changing one without
 * the other breaks every call. This route is the *only* place session cookies
 * are set, which is why the auth flows go through the browser client rather than
 * Server Actions — the latter would additionally need Better Auth's
 * `nextCookies()` plugin to be able to set them.
 */
export const { GET, POST } = toNextJsHandler(auth);
