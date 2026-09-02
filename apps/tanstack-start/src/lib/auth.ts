import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

import { readSessionRole } from '@acme/auth/server';

import { auth } from '~/lib/auth-server';

/**
 * Server-resolved auth state for the route guards — the TanStack Start
 * equivalent of the Next.js app's `clerkMiddleware` public/admin route matchers,
 * now reading a Better Auth session instead (ADR 0034).
 *
 * `getRequestHeaders()` exposes the in-flight request's headers, so the HttpOnly
 * session cookie reaches `auth.api.getSession` on the initial SSR load and on
 * client navigations alike. Under Clerk this read went through a request context
 * that `clerkMiddleware()` had to populate first; nothing has to run before this.
 *
 * **What it returns, and what it deliberately does not.** Callers get the three
 * things the app actually renders — the id, the role, and the display fields the
 * user button shows — rather than Better Auth's `{ session, user }` as resolved.
 * That is a security boundary, not tidying: the resolved `session` carries
 * `token`, the opaque value the session cookie holds, and a server function's
 * return value is serialized into the SSR payload and readable by client
 * JavaScript. Returning it would hand the browser the one credential the HttpOnly
 * cookie exists to keep away from it.
 */
export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });

    if (!session) return { userId: null, role: null, user: null };

    const { id, name, email, image } = session.user;

    return {
      userId: id,
      // Parsed off the user object rather than read as a property: Better Auth
      // types `getSession` as returning the core columns only, so the admin
      // plugin's `role` is a runtime fact with no static promise behind it.
      // `readSessionRole` is where that gets validated (ADR 0034).
      role: readSessionRole(session.user),
      // Shaped for `@acme/ui`'s `UserButtonUser`, which the console shell feeds
      // straight into the signed-in menu.
      user: { name, email, imageUrl: image },
    };
  },
);
