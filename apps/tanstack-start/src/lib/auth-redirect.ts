/**
 * The guards' half of the `?redirect=` contract. The *rule* — reject anything
 * that is not a same-site path — is `@acme/ui`'s `authSearchSchema`, shared with
 * `apps/nextjs`; what stays here is the router-shaped throw, because
 * `{ to, search }` is TanStack Router's vocabulary and nothing else's.
 *
 * `location.href` is already a same-site path (it is the router's own parsed
 * location), so this only names the search key once instead of spelling the
 * literal at three call sites.
 */
export function redirectToSignIn(href: string) {
  return { to: '/sign-in', search: { redirect: href } } as const;
}
