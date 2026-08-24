/**
 * `@acme/env` — the one mechanism a slice uses to declare its environment
 * (ADR 0033). A slice writes a single `createEnv` call in a single `env.ts`:
 *
 * - `withProfiles` layers the `APP_ENV`-selected profile onto the call through
 *   t3-env's `createFinalSchema` seam. A key the profile supplies a value for is
 *   **config**; a key it doesn't is a **secret**. That is the whole distinction —
 *   mechanical, not editorial.
 * - `resolveAppEnv` turns the raw `APP_ENV` selector into the closed `AppEnv` set.
 * - `shouldSkipEnvValidation` decides when a run cannot supply secrets. It is
 *   consumed *inside* `withProfiles`, per key: `createEnv`'s own `skipValidation`
 *   is never passed, anywhere, because it returns `runtimeEnv` raw and would
 *   discard every config default (and the client access guard) along with it.
 * - `readEnv` and `jsonEnv` are what make **every** key overridable (ADR 0033
 *   §4): `readEnv` is the `process.env` read that survives the client bundle,
 *   and `jsonEnv` lets a key whose value is not a string accept a JSON document.
 *
 * This package absorbed `@acme/config` (ADR 0033 supersedes ADR 0026 §§2, 4, 6).
 */
export { withProfiles } from './profiles';
export type { Profiles } from './profiles';
export { resolveAppEnv, appEnvSchema, APP_ENVS } from './app-env';
export type { AppEnv } from './app-env';
export { shouldSkipEnvValidation } from './should-skip-env-validation';
export { readEnv } from './read-env';
export { jsonEnv } from './json-env';
