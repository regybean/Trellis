import { clerkMiddleware } from '@clerk/tanstack-react-start/server';
import { createStart } from '@tanstack/react-start';

/**
 * Global Start instance. Registering Clerk's request middleware here populates
 * the Start request context so `auth()` / `clerkClient()` work inside server
 * functions and API-route handlers — this is the TanStack Start side of the
 * app-owned auth seam (the Next.js app does the equivalent via its own
 * `@clerk/nextjs/server` resolver). See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [clerkMiddleware()],
}));
