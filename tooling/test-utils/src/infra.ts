/**
 * Test-infra descriptor contract.
 *
 * A backend suite declares the infra it needs as an explicit list of
 * `InfraDescriptor`s (see `backendProject`). The descriptors are **pure data**
 * owned by the package that owns the infra (`@acme/db/testing`,
 * `@acme/redis/testing`) — image, ports, container env, wait strategy, bind
 * mounts, and how to project the running container's host/port back into the
 * `process.env` keys that infra's `env.ts` validates. This module (the engine)
 * is the only place that turns a descriptor into a running container, so the
 * owners carry no `testcontainers` dependency. See docs/adr/0017.
 *
 * Because the descriptors are pure, serialisable data, `backendProject` hands
 * them to the shared global-setup (a module path, which can't receive live
 * objects) by JSON-encoding them into the test env under `INFRA_ENV_KEY` — the
 * same env channel `NEXT_PUBLIC_WEBAPP` already uses to reach global-setup.
 */

/** Test-env key carrying the JSON-encoded `InfraDescriptor[]` for the suite. */
export const INFRA_ENV_KEY = 'ACME_TEST_INFRA';

export interface InfraBindMount {
  /** Path relative to the monorepo root; the engine resolves it to absolute. */
  repoPath: string;
  target: string;
  mode?: 'ro' | 'rw';
}

export interface InfraDescriptor {
  /**
   * Stable infra name (e.g. `postgres`, `redis`). Matches the `acme.infra`
   * vocabulary. The engine gates the app db-migrate step on `postgres`.
   */
  name: string;
  /** Pinned image, matching the docker-compose service it stands in for. */
  image: string;
  /** Container-internal port to expose + map. */
  containerPort: number;
  /** Port to probe when a local docker-compose stack is used instead (non-CI). */
  localPort: number;
  /** Env vars set inside the container (e.g. Postgres credentials). */
  containerEnv?: Record<string, string>;
  /** Log line (a `RegExp` source string) signalling readiness. */
  waitLogRegex: string;
  /** Times the log line must appear (Postgres logs "ready" twice). Default 1. */
  waitLogTimes?: number;
  bindMounts?: InfraBindMount[];
  /**
   * The `process.env` keys this infra populates for test workers, as templates.
   * `{host}` / `{port}` are interpolated from the running (or local) container;
   * every other value is a literal. Kept declarative (no functions) so the
   * descriptor stays plain, serialisable data.
   */
  provides: Record<string, string>;
}

/** Parse the descriptors `backendProject` encoded into the test env. */
export function readInfraFromEnv(raw: string | undefined): InfraDescriptor[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${INFRA_ENV_KEY} did not contain a descriptor array`);
  }
  return parsed as InfraDescriptor[];
}
