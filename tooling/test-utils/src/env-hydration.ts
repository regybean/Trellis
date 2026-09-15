/**
 * The env-hydration rule, as a function over values.
 *
 * Given what `global-setup` published for a suite's infra and the logical Redis
 * DB that suite was allocated, `hydrateEnv` returns the `process.env` entries a
 * test worker should carry. It writes nothing: the assignment belongs to the
 * caller, which is `./hydrate-env` — the setupFile that runs it on import.
 *
 * Keeping the decision separate from the write is what makes it assertable. As
 * a top-level side effect, the only handle a test had on the Redis allocation
 * or the url rewrite was import order, and import order is not a thing a test
 * can vary.
 */

/**
 * The inputs the rule reads, named rather than positional so a caller can't
 * transpose the injected record and the DB number.
 */
export interface HydrateEnvInput {
  /**
   * The merged connection env `global-setup` published as one `infraEnv`
   * record. Typed as `process.env` is, rather than as `Record<string, string>`:
   * it crosses a process boundary, so the empty and absent cases are real.
   */
  infraEnv: Readonly<Record<string, string | undefined>>;
  /**
   * `TEST_REDIS_DB` — the suite's dedicated Redis logical DB, when it has one.
   * Suites run in parallel against one Redis, so this is what keeps another
   * suite's `flushDb()` off our keys.
   */
  redisDb?: string;
}

/**
 * The `process.env` entries this suite's infra resolves to.
 *
 * Every key the infra contributes, generically — no per-key list — minus the
 * ones it left empty, since an empty value would overwrite a real default with
 * nothing. Then Redis, if both halves are present: `redis://host:port/2` is a
 * valid url, so the logical DB rides on the url rather than a separate key.
 */
export function hydrateEnv({ infraEnv, redisDb }: HydrateEnvInput) {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(infraEnv)) {
    if (value !== undefined && value !== '') {
      resolved[key] = value;
    }
  }

  if (resolved.REDIS_URL && redisDb) {
    resolved.REDIS_URL = `${resolved.REDIS_URL.replace(/\/+$/, '')}/${redisDb}`;
  }

  return resolved;
}
