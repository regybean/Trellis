import type { StandardSchemaV1 } from '@t3-oss/env-core';
import { merge } from 'ts-deepmerge';
import { z } from 'zod/v4';

import type { AppEnv } from './app-env';
import { shouldSkipEnvValidation } from './should-skip-env-validation';

/**
 * A `createEnv` schema dictionary — the `server` / `client` / `shared` shapes a
 * slice declares, or their intersection as `createFinalSchema` receives it.
 */
type EnvShape = Record<string, z.ZodType>;

/**
 * One profile's values, typed against the **input** of each key's schema so a
 * wrong literal is a compile error, not just a runtime one (ADR 0026's
 * authoring-time-safety sub-decision, preserved by ADR 0033). Every key is
 * optional: `default` supplies the base set and an overlay patches a subset.
 *
 * An overlay may also set a key to `undefined`, which **unauthors** it — the key
 * carries no profile value on that target and is therefore a secret there. That
 * is the only way to express "config in development, credential in production",
 * because `default` *is* the development profile and every overlay merges over
 * it (`@acme/ingest`'s LocalStack credentials, `@acme/billing`'s localstripe
 * placeholders).
 */
type ProfileValues<TShape extends EnvShape> = {
  [K in keyof TShape]?: z.input<TShape[K]> | undefined;
};

/**
 * The closed profile set (ADR 0026 §3): `default` *is* `development`; `staging`
 * and `production` are optional overlays merged over it. A target with no
 * overlay of its own inherits the base — which in this repo is the deliberate
 * rule, not an oversight: every key is env-overridable (ADR 0033 §4), so a
 * deploy target's own values arrive as environment variables and a slice does
 * not have to be re-authored to be deployable. Authoring an overlay is for
 * values that belong in version control.
 */
export interface Profiles<TShape extends EnvShape> {
  default: ProfileValues<TShape>;
  staging?: ProfileValues<TShape>;
  production?: ProfileValues<TShape>;
}

/** The validated (post-coercion) value of every key in a shape. */
type ShapeOutput<TShape extends EnvShape> = {
  [K in keyof TShape]: z.output<TShape[K]>;
};

/**
 * Resolve the `APP_ENV`-selected overlay over `default`. `development` *is* the
 * base, so it has no overlay of its own — which is why this reads as a switch on
 * the closed set rather than an index into the profiles.
 *
 * Arrays **replace** rather than concatenate (`mergeArrays: false`): an overlay
 * that sets a list means "use this list", not "append to the base's" (ADR 0026
 * §3's array-merge sub-decision).
 */
function resolveProfile(appEnv: AppEnv, profiles: Profiles<EnvShape>) {
  if (appEnv === 'development') return { ...profiles.default };
  const overlay = appEnv === 'staging' ? profiles.staging : profiles.production;
  return merge.withOptions(
    { mergeArrays: false },
    profiles.default,
    overlay ?? {},
  );
}

/**
 * Build the schema `createEnv` validates `runtimeEnv` against.
 *
 * Two things happen per key, and which one is decided **mechanically** by
 * whether the resolved profile supplies a value (ADR 0033 §1):
 *
 * - **It does — the key is config.** The value is attached with `.prefault()`,
 *   not `.default()`: prefault feeds the literal *through* the schema, so a
 *   profile value is coerced and validated like any other input. `.default()`
 *   would short-circuit parsing and let an invalid literal through.
 * - **It doesn't — the key is a secret.** It stays required, unless this run
 *   cannot supply one (`shouldSkipEnvValidation()`), in which case it is relaxed
 *   to optional. This is the per-key replacement for `createEnv`'s
 *   `skipValidation`, which returns `runtimeEnv` raw and would discard every
 *   config default alongside the secrets (ADR 0033 §3).
 *
 * "Supplies a value" means a value that is not `undefined`, so an overlay can
 * unauthor a key the base authored and turn it into a secret on that target.
 */
function buildShape(
  shape: EnvShape,
  defaults: Map<string, unknown>,
  relaxSecrets: boolean,
) {
  const built = new Map<string, z.ZodType>();
  for (const [key, schema] of Object.entries(shape)) {
    const authored = defaults.get(key);
    if (authored !== undefined) built.set(key, schema.prefault(authored));
    else if (relaxSecrets) built.set(key, schema.optional());
    else built.set(key, schema);
  }
  return z.object(Object.fromEntries(built));
}

/**
 * The **single type-boundary assertion** in this package. `buildShape` composes
 * its object from a `Record<string, z.ZodType>`, so its static output is
 * `Record<string, unknown>` — the precise shape is knowable only from the
 * caller's `TShape`, which is what the annotation restores.
 *
 * It is also where the skip path's one honest divergence lives: when
 * `shouldSkipEnvValidation()` relaxed the secrets, a secret absent from the
 * environment is absent from the parsed value too, while the type says it is
 * present. That is deliberate — it is exactly what `skipValidation: true` did
 * before, and the alternative (a `string | undefined` on every secret) would
 * push the skip path's shape onto every real caller.
 */
function parseWithShape<TOutput>(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data as TOutput;
}

/**
 * `APP_ENV` profile layering for a `createEnv` call, via t3-env's public
 * `createFinalSchema` seam (ADR 0033) — no fork, no patch:
 *
 * ```ts
 * export const env = createEnv({
 *   server: {
 *     DB_HOST: z.string().nonempty(),
 *     DB_PORT: z.coerce.number().int().positive(),
 *     DB_PASSWORD: z.string().nonempty(), // no profile value -> secret
 *   },
 *   createFinalSchema: (shape) =>
 *     withProfiles(shape, appEnv, {
 *       default: { DB_HOST: 'localhost', DB_PORT: 5444 },
 *       production: { DB_HOST: 'db.internal' },
 *     }),
 *   runtimeEnv: { DB_HOST: readEnv('DB_HOST'), ... },
 * });
 * ```
 *
 * `shape` is passed rather than closed over so its type flows in from the
 * sibling `server`/`client`/`shared` dictionaries — that is what types the
 * profile literals and what makes the returned schema's output the slice's env
 * type. It also matters at runtime: on the client `createEnv` hands
 * `createFinalSchema` only the client + shared keys, so a server key's profile
 * value is simply not applied there (and reading that key throws, per t3-env's
 * access guard).
 *
 * **A key is env-overridable iff it appears in the call's `runtimeEnv`** — and
 * every key does (ADR 0033 §4). Profile values are attached to the schema, so a
 * key left out of `runtimeEnv` could never be reached by a same-named variable
 * in the environment.
 */
export function withProfiles<TShape extends EnvShape>(
  shape: TShape,
  appEnv: AppEnv,
  profiles: Profiles<TShape>,
): StandardSchemaV1<Record<string, unknown>, ShapeOutput<TShape>> {
  const schema = buildShape(
    shape,
    new Map(Object.entries(resolveProfile(appEnv, profiles))),
    shouldSkipEnvValidation(),
  );

  return {
    '~standard': {
      version: 1,
      vendor: 'acme-env',
      validate: (value) => ({
        value: parseWithShape<ShapeOutput<TShape>>(schema, value),
      }),
    },
  };
}
