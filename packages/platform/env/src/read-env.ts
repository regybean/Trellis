/**
 * Read one variable off the ambient environment, safely in both runtimes.
 *
 * Every key is env-overridable (ADR 0001 §4), which means every slice's
 * `runtimeEnv` now reads `process.env` for keys a bundler has no reason to
 * inline — and some of those slices build their env **in the browser** (any
 * slice with a `shared` key, e.g. `@acme/billing`'s Stripe plan ids). Vite
 * inlines only `process.env.NEXT_PUBLIC_*`, `process.env.APP_ENV` and
 * `process.env.NODE_ENV` (see `apps/tanstack-start/vite.config.ts`); any other
 * `process.env.X` survives into the client bundle as a bare `process` reference,
 * and `process` does not exist there. That is a ReferenceError while the env
 * module is still evaluating — a throw on import that kills hydration.
 *
 * `typeof process` is the guard rather than `process !== undefined`, because
 * `typeof` on an undeclared identifier is the one read that cannot throw. In the
 * browser this returns `undefined` for every key, so the profile value applies
 * (`.prefault()`) and client behaviour is exactly what config-as-code gave
 * before overrides existed. That is the honest boundary: a browser has no
 * environment to be overridden from — only the server process it was served by
 * does.
 *
 * The index access is deliberate and is why this helper does **not** replace the
 * literal `process.env.NEXT_PUBLIC_WEBAPP` / `process.env.NODE_ENV` reads in the
 * slices. Those must stay written out longhand: static inlining is a textual
 * substitution, so `process.env[key]` is invisible to it and the value would
 * vanish from the client bundle.
 */
export function readEnv(key: string) {
  // The index access is by a literal authored in a slice's `runtimeEnv`, never
  // user input — reading a variable by name is the whole job.
  return typeof process === 'undefined' ? undefined : process.env[key];
}
