import { postgresContainer } from '@acme/db/testing';
import { runInfraSetup } from '@acme/test-utils/setup';

// This suite touches a real Postgres (Better Auth's four tables in the `auth`
// schema) and nothing else — sessions are rows, so there is no Redis here.
export default runInfraSetup([postgresContainer]);
