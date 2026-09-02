import { z } from 'zod';

/**
 * Where to land after signing in or up.
 *
 * The value arrives in the query string, put there by whichever `beforeLoad`
 * guard bounced the visitor, so it is attacker-controllable and normalised to a
 * **same-site absolute path**: it must start with a single `/`. Rejecting
 * `//evil.example` matters as much as rejecting `https://evil.example` — a
 * protocol-relative URL is an off-site navigation that reads as a path.
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
  // that, and the router reads the schema's input type to decide whether `search`
  // is required at every `<Link to="/sign-in">`.
  .optional();

export const authSearchSchema = z.object({ redirect: redirectTarget });

/**
 * The guards' half of the same contract. `location.href` is already a same-site
 * path (it is the router's own parsed location), so this only names the search
 * key once instead of spelling the literal at three call sites.
 */
export function redirectToSignIn(href: string) {
  return { to: '/sign-in', search: { redirect: href } } as const;
}
