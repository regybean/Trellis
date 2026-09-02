import { z } from 'zod';

/**
 * Where to land after signing in or up.
 *
 * The value arrives in the query string, put there by whichever guard bounced
 * the visitor — Next.js middleware or a TanStack Start `beforeLoad` — so it is
 * attacker-controllable and normalised to a **same-site absolute path**: it must
 * start with a single `/`. Rejecting `//evil.example` matters as much as
 * rejecting `https://evil.example`: a protocol-relative URL is an off-site
 * navigation that reads as a path, and `?redirect=` is handed to the browser at
 * the exact moment the visitor has just authenticated.
 *
 * This lives beside `auth-credentials.ts` rather than in either app because both
 * apps have the same hole to close and it is framework-free — the guards differ,
 * the rule does not. `apps/nextjs` shipped without the check (#238); this is
 * `apps/tanstack-start`'s version (#237), shared (#239).
 *
 * A transform rather than a validation, so it cannot fail: a malformed
 * `redirect` should drop the visitor on the home page, not 400 the sign-in form
 * and leave them with no way in.
 */
const redirectTarget = z
  .unknown()
  .transform((value) =>
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
      ? value
      : undefined,
  )
  // `.optional()` on the *pipe*, not on `z.unknown()`: an unwrapped `unknown`
  // already makes an object key optional, but wrapping it in a transform loses
  // that, and TanStack Router reads the schema's input type to decide whether
  // `search` is required at every `<Link to="/sign-in">`.
  .optional();

/** The `?redirect=` search contract, for a router that parses search up front. */
export const authSearchSchema = z.object({ redirect: redirectTarget });

/**
 * The same rule for a caller that reads the parameter itself — `useSearchParams`
 * in the Next.js app — returning the path to navigate to, home by default.
 */
export function toSameSitePath(value: unknown) {
  return redirectTarget.parse(value) ?? '/';
}
