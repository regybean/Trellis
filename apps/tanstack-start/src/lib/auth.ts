import { auth } from '@clerk/tanstack-react-start/server';
import { createServerFn } from '@tanstack/react-start';

/**
 * Server-resolved Clerk session state (userId + role). Route `beforeLoad`
 * guards call this — it is the TanStack Start equivalent of the Next.js app's
 * `clerkMiddleware` public/admin route matchers. `auth()` reads the Start
 * request context populated by `clerkMiddleware()` (see `src/start.ts`).
 */
export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { userId, sessionClaims } = await auth();
    return { userId, role: sessionClaims?.metadata.role ?? null };
  },
);
