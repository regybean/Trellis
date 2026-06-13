import { NextResponse } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/learn(.*)',
  '/roadmap(.*)',
  '/pricing(.*)',
  '/api/openapi',
  '/api/health',
  '/api/trpc/clerk(.*)',
  '/api/stripe',
  '/api/trpc/reviews.featured',
  '/maturity-assessment(.*)',
  '/terms-of-service',
  '/privacy-policy',
]);
const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
  '/docs(.*)',
  '/api/trpc/reviews.feature',
  '/api/trpc/reviews.unfeature',
  '/api/trpc/reviews.delete',
  '/api/trpc/bugs.list',
  '/api/trpc/bugs.delete',
]);

/**
 * Middleware function that protects non-public routes using Clerk authentication.
 *
 * @param auth - The Clerk authentication object
 * @param request - The incoming HTTP request
 * @returns A Promise that resolves after authentication check
 *
 * @example
 * // This middleware automatically checks if the route is public (sign-in)
 * // If not public, it requires authentication
 */

// In future we might want to add some middleware for stripe subscriptions,
// however at the moment we don't have any pages that require a subscription
export default clerkMiddleware(async (auth, request) => {
  // if not sign in then protect the route
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
  // if it is an admin route and your an admin then go to that route
  if (isAdminRoute(request)) {
    const authResult = await auth();
    if (authResult.sessionClaims?.metadata.role !== 'admin') {
      const url = new URL('/', request.url);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

/**
 * Configuration object for Next.js middleware matching patterns.
 * @property {string[]} matcher - Array of URL patterns to match for middleware execution
 * @remarks
 * The matcher array contains two patterns:
 * 1. Excludes Next.js internals and static files from middleware processing unless found in search params
 * 2. Always processes routes starting with /api or /trpc
 */
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    `/((?!_next|[^?]*.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)`,
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
