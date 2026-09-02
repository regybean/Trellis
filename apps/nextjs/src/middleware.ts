import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Routes a signed-out visitor may reach. Everything else bounces to `/sign-in`.
 *
 * Kept as the same list Clerk's `createRouteMatcher` held, minus the Clerk-only
 * `/api/trpc/clerk` mount, plus `/api/auth` — Better Auth's own endpoints are
 * self-gating and must stay reachable while signed out, or signing in would
 * require being signed in.
 */
/** Public routes with no sub-paths. */
const PUBLIC_EXACT = new Set([
  '/',
  '/api/openapi',
  '/api/health',
  '/api/stripe',
  '/api/trpc/reviews.featured',
  '/terms-of-service',
  '/privacy-policy',
]);

/** Public route trees: the path itself and anything beneath it. */
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/learn',
  '/roadmap',
  '/pricing',
  '/api/auth',
  '/maturity-assessment',
];

// Prefix matching on path *segments*, not Clerk's `'/sign-in(.*)'` patterns,
// which also matched unrelated siblings like `/sign-integration`.
const isPublicRoute = (pathname: string) =>
  PUBLIC_EXACT.has(pathname) ||
  PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

/**
 * Optimistic sign-in gate.
 *
 * **This is a redirect, not an authorisation check.** `getSessionCookie` only
 * tests that a session cookie is *present* — it does not validate the token, so
 * anyone can forge one and get past this. That is Better Auth's documented
 * recommendation for Next.js middleware, and the reason is structural: sessions
 * here are database rows with the cookie cache deliberately off (ADR 0034), and
 * middleware runs on the Edge runtime, which has no database. Validating here
 * would mean either a per-request HTTP hop to our own `/api/auth/get-session`,
 * or Node-runtime middleware — experimental before Next 16, and this app is on
 * 15.5. So the cheap check buys the redirect and nothing else.
 *
 * The real gates are unchanged and all server-side: every tRPC call resolves the
 * session row through `protectedProcedure` / `adminProcedure`, and `/admin`
 * re-checks the role in the page itself. Admin routes are therefore *not*
 * matched here — the role is not in the cookie, so middleware could not decide
 * them without lying about it. `/docs` came out of the old admin list with it;
 * no such route exists.
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname) || getSessionCookie(request)) {
    return NextResponse.next();
  }

  // Carry the attempted route so sign-in can resume it rather than dumping the
  // visitor on the home page.
  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set(
    'redirect',
    `${pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(signInUrl);
}

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
