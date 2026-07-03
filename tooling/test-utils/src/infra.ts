/**
 * Test-infra descriptor contract.
 *
 * A backend suite declares the infra it needs by pointing its `globalSetup` at a
 * tiny per-suite file that imports the descriptors and hands them to
 * `runInfraSetup(...)`. The descriptors are owned by the package that owns the
 * infra (`@acme/db/testing`, `@acme/redis/testing`) — image, ports, container
 * env, wait strategy, bind mounts, and a `provides(host, port)` function that
 * maps the running container's host/port to the `process.env` keys that infra's
 * `env.ts` validates. This module (`@acme/test-utils`, the engine) is the only
 * place that turns a descriptor into a running container, so the owners carry no
 * `testcontainers` dependency. See docs/adr/0017.
 */

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
  /**
   * Port to probe when a local docker-compose stack is used instead (non-CI).
   * Defaults to `containerPort` (the standard case — compose publishes it 1:1).
   */
  localPort?: number;
  /** Env vars set inside the container (e.g. Postgres credentials). */
  containerEnv?: Record<string, string>;
  /** Log line (a `RegExp` source string) signalling readiness. */
  waitLogRegex: string;
  /** Times the log line must appear (Postgres logs "ready" twice). Default 1. */
  waitLogTimes?: number;
  bindMounts?: InfraBindMount[];
  /**
   * Map the running (or local) container's host/port to the `process.env` keys
   * this infra populates for test workers. A plain function — the per-suite
   * global-setup imports the descriptor as a live object, so no serialisation
   * is involved.
   */
  provides: (host: string, port: number) => Record<string, string>;
}
