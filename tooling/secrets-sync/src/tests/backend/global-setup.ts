/**
 * Global setup for the secrets round-trip test.
 *
 * LocalStack is just another `InfraDescriptor` — its sole consumer is this
 * package's own round-trip test, so the descriptor lives here rather than in an
 * owner package. It goes through the same `runInfraSetup` engine as Postgres
 * and Redis, and the endpoint reaches the test as
 * `inject('infraEnv').AWS_ENDPOINT_URL`.
 */
import type { InfraDescriptor } from '@acme/test-utils/infra';
import { runInfraSetup } from '@acme/test-utils/setup';

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
