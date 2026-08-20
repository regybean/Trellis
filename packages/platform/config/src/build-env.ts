import type { OverrideBag } from './overrides';
import { describeConfig } from './create-config';
import { CLIENT_OVERRIDES_VAR } from './overrides';

/**
 * The build-time half of the client override lane (ADR 0033 §3), called from
 * each app's bundler config — `next.config.js`'s `env` map and
 * `vite.config.ts`'s `define` map.
 *
 * Client config is frozen into the bundle, so its overrides have to be sampled
 * while the bundler runs. This reads the app's composed config to *derive* which
 * leaf names are client-overridable (never a hand-kept list — that would drift
 * the moment a slice adds a key), picks up whichever of them are set in the
 * build environment, and returns the entries to inject:
 *
 * - one per leaf, so the name appears in the bundler's map and is greppable —
 *   the same names go in `turbo.json` `globalEnv`, which is what makes a changed
 *   client override bust the build cache;
 * - `ACME_CONFIG_CLIENT_OVERRIDES`, the whole lane as one JSON literal. This is
 *   what the app's `env.ts` actually reads back, because browser code cannot
 *   enumerate `process.env` under either bundler — both rewrite individual
 *   member expressions and neither exposes the bag.
 *
 * Unset and empty variables are dropped, so an untouched build inlines an empty
 * lane and every value falls through to its profile.
 */
export function clientOverrideBuildEnv(
  config: object,
  env: OverrideBag,
): Record<string, string> {
  const { clientOverridePaths } = describeConfig(config);
  const lane: Record<string, string> = {};
  for (const path of clientOverridePaths) {
    const value = env[path];
    if (value !== undefined && value !== '') lane[path] = value;
  }
  return { ...lane, [CLIENT_OVERRIDES_VAR]: JSON.stringify(lane) };
}
