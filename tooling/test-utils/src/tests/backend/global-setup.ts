/**
 * Global setup for the secrets-backend test.
 *
 * LocalStack is just another `InfraDescriptor` — its sole consumer is this
 * package's own secrets test, so the descriptor lives here rather than in an
 * owner package. It goes through the same `runInfraSetup` engine as Postgres and
 * Redis: a testcontainer in CI, an assumed `pnpm infra:up` service locally. The
 * endpoint reaches the test as `inject('infraEnv').AWS_ENDPOINT_URL`.
 */
import type { InfraDescriptor } from '../../infra';
import { runInfraSetup } from '../../setup';

const localstackContainer: InfraDescriptor = {
  name: 'localstack',
  // Pin to a community image — `:latest` can resolve to a license-gated build.
  image: 'localstack/localstack:3.8.1',
  containerPort: 4566,
  containerEnv: { SERVICES: 's3,secretsmanager' },
  waitLogRegex: 'Ready.',
  provides: (host, port) => ({ AWS_ENDPOINT_URL: `http://${host}:${port}` }),
};

export default runInfraSetup([localstackContainer]);
