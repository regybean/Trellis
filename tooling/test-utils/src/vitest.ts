/**
 * Shared Vitest test env + backend/frontend project presets.
 *
 * `staticTestEnv` is the one place static, non-secret env lives so every
 * package's `env.ts` (`createEnv`) validates against real values instead of
 * being hand-mocked in each `setup.ts`. It is spread into both backend and
 * frontend configs. Dynamic, per-run DB/Redis connection details are hydrated
 * separately from testcontainers by `@acme/test-utils/hydrate-env`.
 *
 * `backendProject` and `frontendProject` fold the identical per-side wiring into
 * one call each, so a package's `vitest.config.<side>.ts` only declares what's
 * unique to it — for the backend the hydrate-env setupFile ordering, the
 * testcontainer globalSetup, the single non-isolated forked worker and the
 * generous timeouts; for the frontend the react plugin and the jsdom
 * environment. Both own the `include` glob outright: test layout is one
 * convention (`src/tests/<layer>/<kind>[/<group>]/`), not a per-package choice.
 */
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

/**
 * Static, non-secret env shared by every suite. Values only need to satisfy
 * each `env.ts` schema — they are never used to reach a real service.
 *
 * `NEXT_PUBLIC_WEBAPP` is a neutral default (a valid Postgres identifier);
 * backend suites override it per-package for schema isolation.
 *
 * Provider selection + model ids: ai-sdk factories only build config objects at
 * import (no network), so `@acme/models` resolve.ts constructs fine with these
 * — no `@acme/models` mock needed.
 */
export const staticTestEnv = {
  NEXT_PUBLIC_WEBAPP: 'testing',
  // The deploy-target selector. Set explicitly (rather than leaning on the
  // unset→development default) so suites document that they validate against the
  // base profile. See @acme/env ADR 0001.
  APP_ENV: 'development',
  // Every slice's non-secret values — provider selection, model ids, region, S3
  // endpoint + bucket, vector db name, chunk sizes, embedding dimension, the
  // Stripe plan ids/connection/checkout paths, the TTLs — are authored in each
  // slice's `env.ts` development profile (@acme/env ADR 0001), so no test env is needed for
  // them. The development profile also authors the *local* credentials that a
  // real deploy must supply (LocalStack's dummy AWS pair, localstripe's fixed
  // placeholders), which is why they are absent here too: a suite validating
  // against the authored values is validating what dev actually runs.
  //
  // Fallback for infra-less suites (e.g. ingest, whose @acme/redis/env only needs
  // a valid url — Redis is never contacted). Backend suites with a testcontainer
  // have this overwritten per-run by hydrate-env; the authored profile default is
  // the same endpoint, so it is here only to make the intent explicit.
  REDIS_URL: 'redis://localhost:6379',
  // The one secret no profile authors on any target: `@acme/db`'s password. The
  // testcontainer's real value arrives per-run from hydrate-env; this keeps an
  // infra-less suite that merely *imports* `@acme/db/env` from failing validation.
  DB_PASSWORD: 'password123',
  // @acme/auth's env — no profile authors any of these, and the auth suite
  // calls `betterAuthEnv()` through `initAuth`, so they have to be here.
  //
  // `BETTER_AUTH_SECRET` is a real value, not a mock: the suite runs the genuine
  // sign-up/sign-in flow against Postgres, so the secret has to be long enough
  // for scrypt/HMAC to work. `BETTER_AUTH_URL` is only ever used to build
  // callback URLs and check request origins, and the suite calls the API
  // directly rather than over HTTP, so any well-formed origin will do.
  BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
  BETTER_AUTH_URL: 'http://localhost:3000',
} satisfies Record<string, string>;

/**
 * The canonical test layout, `src/tests/<layer>/<kind>[/<group>]/`. The layer
 * segment is present even in a single-sided package: it is not there to
 * disambiguate within a package but so one glob works across all of them, and
 * so the path prefix is a filter axis tooling can trust. Neither factory takes
 * an `include` override — a suite that collected nothing would pass silently
 * (`passWithNoTests`), so the glob is the factory's to own, not a caller's.
 */
const BACKEND_INCLUDE = 'src/tests/backend/**/*.test.ts';
const FRONTEND_INCLUDE = 'src/tests/frontend/**/*.test.{ts,tsx}';

interface BackendProjectOptions {
  /**
   * Dedicated Postgres schema for this suite (parallel cleanup isolation).
   * turbo runs feature backend suites concurrently against one shared database.
   * Also drives the per-app Redis key namespace.
   */
  webapp: string;
  /**
   * Dedicated Redis logical DB for this suite (parallel flushDb isolation).
   * Appended to the injected REDIS_URL by hydrate-env when set.
   */
  redisDb?: string;
  /** The package's own setup file(s), run after hydrate-env. */
  setupFiles?: string[];
  /**
   * Path to this suite's per-suite global-setup file, which imports its
   * `InfraDescriptor`s (as live objects) and hands them to `runInfraSetup`
   * (see docs/adr/0017). Its presence *is* the signal that the suite uses real
   * infra: hydrate-env is prepended to `setupFiles` and the container
   * global-setup runs. Omit for a suite whose externals are all mocked (e.g.
   * `ingest`): no containers, no hydration, so the tests run anywhere.
   */
  globalSetup?: string;
}

export function backendProject({
  webapp,
  redisDb,
  setupFiles = [],
  globalSetup,
}: BackendProjectOptions) {
  // `vitest list` runs globalSetup, so merely *printing* test names would start
  // this suite's testcontainers and push a schema. Collection needs neither:
  // dropping globalSetup drops hydrate-env with it, and every reachable env.ts
  // still validates against `staticTestEnv`. `pnpm test:inventory` sets this;
  // nothing that runs tests does.
  const listOnly = process.env.VITEST_LIST_ONLY !== undefined;
  const hasInfra = globalSetup !== undefined && !listOnly;
  return mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        name: 'backend',
        environment: 'node',
        env: {
          ...staticTestEnv,
          NEXT_PUBLIC_WEBAPP: webapp,
          ...(redisDb ? { TEST_REDIS_DB: redisDb } : {}),
        },
        include: [BACKEND_INCLUDE],
        // With infra, hydrate-env runs first: copies testcontainer connection
        // details into process.env so every env.ts validates against the real
        // DB/Redis. Infra-less suites skip it (their externals are mocked).
        setupFiles: hasInfra
          ? ['@acme/test-utils/hydrate-env', ...setupFiles]
          : setupFiles,
        // Starts/stops the declared testcontainers (needs Docker).
        ...(hasInfra && globalSetup ? { globalSetup: [globalSetup] } : {}),
        // Real DB means generous timeouts and a single, non-isolated worker so
        // tests share one connection/transaction space deterministically.
        testTimeout: 60_000,
        hookTimeout: 60_000,
        pool: 'forks',
        maxWorkers: 1,
        isolate: false,
      },
    }),
  );
}

interface FrontendProjectOptions {
  /** The package's own setup file(s) — providers, jsdom polyfills, MSW server. */
  setupFiles?: string[];
}

/**
 * The frontend counterpart: react plugin, jsdom, and the `staticTestEnv` spread
 * that makes jsdom's client mode validate every reachable `env.ts` against real
 * values rather than a mock (ADR 0014). MSW is the frontier here — there is no
 * infra to provision, so there is no globalSetup analogue (ADR 0018).
 */
export function frontendProject({
  setupFiles = [],
}: FrontendProjectOptions = {}) {
  return mergeConfig(
    baseConfig,
    defineConfig({
      plugins: [react()],
      test: {
        name: 'frontend',
        environment: 'jsdom',
        env: { ...staticTestEnv },
        include: [FRONTEND_INCLUDE],
        setupFiles,
      },
    }),
  );
}
